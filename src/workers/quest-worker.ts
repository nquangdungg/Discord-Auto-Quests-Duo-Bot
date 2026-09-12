import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { users, settings } from '../database';
import { decrypt } from '../utils/crypto';
import { QuestEngine, Quest, ProgressCallback } from '../engine/quest-engine';

interface ActiveWorker {
  userId: string;
  abort: AbortController;
  mode: 'autoquest' | 'auto' | 'quest';
  dms: boolean;
}

const activeWorkers = new Map<string, ActiveWorker>();

/** Cache kênh + settings — tránh fetch DB/API mỗi lần progress */
let notiChannelCache: { id: string; ch: TextChannel; at: number } | null = null;
const CHANNEL_TTL = 120_000;
const tokenCache = new Map<string, { token: string; at: number }>();
const TOKEN_TTL = 300_000;

function progressBar(current: number, total: number, size = 12): string {
  if (total <= 0) return '░'.repeat(size);
  const filled = Math.min(size, Math.max(0, Math.round((current / total) * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

function statusMeta(status: string): { label: string; color: number; emoji: string } {
  switch (status) {
    case 'running':
      return { label: 'In Progress', color: 0x5865f2, emoji: '🔄' };
    case 'completed':
      return { label: 'Completed', color: 0x57f287, emoji: '✅' };
    case 'claimed':
      return { label: 'Reward Claimed', color: 0xfee75c, emoji: '⭐' };
    case 'failed':
      return { label: 'Failed', color: 0xed4245, emoji: '❌' };
    case 'skipped':
      return { label: 'Skipped', color: 0x99aab5, emoji: '⏭️' };
    default:
      return { label: status, color: 0x2b2d31, emoji: '•' };
  }
}

export class QuestWorkerManager {
  constructor(
    private botClient: Client,
    private channelClient?: Client,
  ) {}

  isRunning(userId: string): boolean {
    return activeWorkers.has(userId);
  }

  async stop(userId: string): Promise<boolean> {
    const w = activeWorkers.get(userId);
    if (!w) return false;
    w.abort.abort();
    activeWorkers.delete(userId);
    tokenCache.delete(userId);
    try {
      await users.setAutoQuest(userId, false, w.dms);
    } catch {
      /* ignore */
    }
    return true;
  }

  private async getDecryptedToken(userId: string): Promise<string | null> {
    const hit = tokenCache.get(userId);
    if (hit && Date.now() - hit.at < TOKEN_TTL) return hit.token;

    const u = await users.get(userId);
    if (!u?.encrypted_token) return null;
    try {
      const token = decrypt(u.encrypted_token);
      tokenCache.set(userId, { token, at: Date.now() });
      return token;
    } catch {
      return null;
    }
  }

  private async getNotiChannel(): Promise<TextChannel | null> {
    if (notiChannelCache && Date.now() - notiChannelCache.at < CHANNEL_TTL) {
      return notiChannelCache.ch;
    }
    const id = await settings.get('notiquest_channel');
    if (!id) return null;
    const client = this.channelClient ?? this.botClient;
    try {
      const ch = await client.channels.fetch(id);
      if (ch?.isTextBased()) {
        notiChannelCache = { id, ch: ch as TextChannel, at: Date.now() };
        return notiChannelCache.ch;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Embed progress — không chứa user (ping nằm ở content) */
  private buildStatusEmbed(
    questName: string,
    progress: number,
    target: number,
    status: string,
    extra?: string,
  ): EmbedBuilder {
    const meta = statusMeta(status);
    const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
    const bar = progressBar(progress, target);

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: `${meta.emoji}  ${meta.label}` })
      .setTitle(questName.slice(0, 256))
      .setDescription(`\`${bar}\`  **${pct}%**`)
      .addFields({
        name: 'Progress',
        value: `**${progress}** / **${target}**`,
        inline: true,
      })
      .setTimestamp();

    if (extra) {
      embed.addFields({ name: 'Note', value: extra.slice(0, 1024) });
    }
    return embed;
  }

  /**
   * Gửi/cập nhật progress: mention user NGOÀI embed để Discord ping thật.
   * Throttle: chỉ gửi khi start/end hoặc nhảy ≥10% (tránh spam API).
   */
  private createProgressPoster(userId: string) {
    const progressMessages = new Map<string, string>();
    const lastPct = new Map<string, number>();
    const lastStatus = new Map<string, string>();

    const onProgress: ProgressCallback = async (info) => {
      const channel = await this.getNotiChannel();
      if (!channel) return;

      const pct = info.target > 0 ? Math.round((info.progress / info.target) * 100) : 0;
      const prevPct = lastPct.get(info.questId) ?? -1;
      const prevStatus = lastStatus.get(info.questId);
      const isTerminal = info.status !== 'running';
      const isStart = info.status === 'running' && prevStatus == null;
      const jumped = pct - prevPct >= 10 || pct === 100;

      if (!isStart && !isTerminal && !jumped) return;
      if (prevStatus === info.status && !jumped && !isTerminal) return;

      lastPct.set(info.questId, pct);
      lastStatus.set(info.questId, info.status);

      const embed = this.buildStatusEmbed(
        info.questName,
        info.progress,
        info.target,
        info.status,
        info.message,
      );

      // Ping ngoài embed
      const payload = {
        content: `<@${userId}>`,
        embeds: [embed],
        allowedMentions: { users: [userId] },
      };

      try {
        const existing = progressMessages.get(info.questId);
        if (existing) {
          const msg = await channel.messages.fetch(existing).catch(() => null);
          if (msg) {
            await msg.edit(payload);
            return;
          }
        }
        const sent = await channel.send(payload);
        progressMessages.set(info.questId, sent.id);
      } catch {
        /* ignore */
      }

    };

    return onProgress;
  }

  async resumeFromDatabase(): Promise<void> {
    try {
      const list = await users.getAllAutoQuestUsers();
      console.log(`[Worker] Resume autoquest: ${list.length} user(s)`);
      await Promise.all(
        list.map(async (u) => {
          if (activeWorkers.has(u.user_id)) return;
          const r = await this.startAutoQuest(u.user_id, u.dms_enabled === 1, true);
          console.log(`[Worker] Resume ${u.user_id}: ${r.message}`);
        }),
      );
    } catch (e) {
      console.error('[Worker] resumeFromDatabase failed:', e);
    }
  }

  async startAutoQuest(
    userId: string,
    dms: boolean,
    skipDbWrite = false,
  ): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Bạn đang có AutoQuest chạy. Dùng `/autoquest off` để dừng.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token. Dùng `/token` trước.' };

    if (!skipDbWrite) {
      await users.setAutoQuest(userId, true, dms);
    }

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'autoquest', dms });

    void this.runAutoQuestLoop(userId, token, dms, abort.signal).finally(() => {
      activeWorkers.delete(userId);
    });

    return { ok: true, message: '✅ Đã bật AutoQuest (lưu DB — restart bot vẫn tiếp tục).' };
  }

  private async runAutoQuestLoop(
    userId: string,
    token: string,
    dms: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const onProgress = this.createProgressPoster(userId);
    // inject dms into poster via wrapping
    const wrapped: ProgressCallback = async (info) => {
      await onProgress({ ...info, ...(dms ? {} : {}) });
      if (dms && (info.status === 'claimed' || info.status === 'failed')) {
        try {
          const user = await this.botClient.users.fetch(userId);
          await user
            .send({
              content:
                info.status === 'claimed'
                  ? `⭐ **${info.questName}** — đã claim.`
                  : `❌ **${info.questName}** thất bại${info.message ? `: ${info.message}` : ''}.`,
            })
            .catch(() => {});
        } catch {
          /* ignore */
        }
      }
    };

    while (!signal.aborted) {
      try {
        const engine = new QuestEngine(token);
        await engine.runPending(wrapped, signal);
      } catch (e: any) {
        console.error(`[Worker] autoquest ${userId}:`, e?.message || e);
      }
      if (signal.aborted) break;
      await sleep(signal, 5_000);
    }
  }

  async runOnce(userId: string): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Đang có worker chạy. Hãy dừng trước.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token.' };

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'auto', dms: false });
    const onProgress = this.createProgressPoster(userId);

    try {
      const engine = new QuestEngine(token);
      const results = await engine.runPending(onProgress, abort.signal);
      const lines = results.map((r) => `• ${r.quest.name}: **${r.result}**`);
      return {
        ok: true,
        message: lines.length ? `✅ Xong:\n${lines.join('\n')}` : '✨ Không có quest pending.',
      };
    } catch (err: any) {
      return { ok: false, message: `❌ Lỗi: ${err?.message || 'unknown'}` };
    } finally {
      activeWorkers.delete(userId);
    }
  }

  async runSelected(userId: string, questIds: string[]): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Đang có worker chạy. Hãy dừng trước.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token.' };

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'quest', dms: false });
    const onProgress = this.createProgressPoster(userId);

    try {
      const engine = new QuestEngine(token);
      const all = await engine.loadQuests();
      const selected = all.filter((q) => questIds.includes(q.id));
      const results: string[] = [];
      for (const q of selected) {
        if (abort.signal.aborted) break;
        const result = await engine.execute(q, onProgress, abort.signal);
        results.push(`• ${q.name}: **${result}**`);
      }
      return {
        ok: true,
        message: `✅ Kết quả:\n${results.join('\n') || 'Không có quest nào được chọn.'}`,
      };
    } catch (err: any) {
      return { ok: false, message: `❌ Lỗi: ${err?.message || 'unknown'}` };
    } finally {
      activeWorkers.delete(userId);
    }
  }

  async listPending(userId: string): Promise<{ ok: boolean; quests?: Quest[]; message?: string }> {
    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token.' };
    try {
      const engine = new QuestEngine(token);
      const all = await engine.loadQuests();
      const pending = all.filter(
        (q) => q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired(),
      );
      return { ok: true, quests: pending };
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Không tải được quest' };
    }
  }
}

function sleep(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        r();
      },
      { once: true },
    );
  });
}
