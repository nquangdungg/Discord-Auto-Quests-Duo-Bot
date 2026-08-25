/**
 * Per-user Quest Worker Manager
 * - Supports continuous autoquest loop
 * - One-shot /auto and /quest
 * - Live embed updates on a notification channel
 */
import { EmbedBuilder, TextChannel, Client } from 'discord.js';
import { users, settings } from '../database';
import { decrypt } from '../utils/crypto';
import { QuestEngine, Quest, ProgressCallback } from '../engine/quest-engine';

interface ActiveWorker {
  userId: string;
  abort: AbortController;
  mode: 'autoquest' | 'auto' | 'quest';
  startedAt: number;
}

const activeWorkers = new Map<string, ActiveWorker>();

function statusEmoji(s: string) {
  switch (s) {
    case 'running': return '🔄';
    case 'completed': return '✅';
    case 'claimed': return '⭐';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '❓';
  }
}

function progressBar(current: number, total: number, size = 12): string {
  if (total <= 0) return '░'.repeat(size);
  const filled = Math.min(size, Math.round((current / total) * size));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

export class QuestWorkerManager {
  constructor(private botClient: Client) {}

  isRunning(userId: string): boolean {
    return activeWorkers.has(userId);
  }

  stop(userId: string): boolean {
    const w = activeWorkers.get(userId);
    if (!w) return false;
    w.abort.abort();
    activeWorkers.delete(userId);
    return true;
  }

  private async getDecryptedToken(userId: string): Promise<string | null> {
    const u = await users.get(userId);
    if (!u?.encrypted_token) return null;
    try {
      return decrypt(u.encrypted_token);
    } catch {
      return null;
    }
  }

  private async getNotiChannel(): Promise<TextChannel | null> {
    const id = await settings.get('notiquest_channel');
    if (!id) return null;
    try {
      const ch = await this.botClient.channels.fetch(id);
      if (ch?.isTextBased()) return ch as TextChannel;
    } catch { /* ignore */ }
    return null;
  }

  private buildProgressEmbed(
    userId: string,
    questName: string,
    progress: number,
    target: number,
    status: string,
    extra?: string,
  ): EmbedBuilder {
    const remaining = Math.max(0, target - progress);
    const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;

    const statusLabel: Record<string, string> = {
      running: 'Đang chạy',
      completed: 'Hoàn thành',
      claimed: 'Đã nhận thưởng',
      failed: 'Thất bại',
      skipped: 'Bỏ qua',
    };

    const embed = new EmbedBuilder()
      .setColor(
        status === 'claimed' || status === 'completed'
          ? 0x57f287
          : status === 'failed'
            ? 0xed4245
            : status === 'skipped'
              ? 0x99aab5
              : 0x5865f2,
      )
      .setAuthor({ name: statusLabel[status] || status })
      .setTitle(questName.slice(0, 256))
      .setDescription(
        [
          `${progressBar(progress, target)} **${pct}%**`,
          '',
          '```',
          `${String(progress).padStart(6)} / ${target}   ·   còn ${remaining}s`,
          '```',
        ].join('\n'),
      )
      .addFields(
        { name: 'Người dùng', value: `<@${userId}>`, inline: true },
        { name: 'Trạng thái', value: `${statusEmoji(status)} \`${status}\``, inline: true },
      )
      .setTimestamp();

    if (extra) {
      embed.addFields({ name: 'Ghi chú', value: extra.slice(0, 1024) });
    }

    return embed;
  }

  /**
   * Start continuous autoquest loop for a user.
   */
  async startAutoQuest(userId: string, dms: boolean): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Bạn đang có worker chạy rồi. Dùng `/autoquest off` để dừng.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token. Dùng `/token` trước.' };

    await users.setAutoQuest(userId, true, dms);

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'autoquest', startedAt: Date.now() });

    // Fire and forget loop
    this.runAutoQuestLoop(userId, token, dms, abort.signal).finally(async () => {
      activeWorkers.delete(userId);
      try {
        await users.setAutoQuest(userId, false, dms);
      } catch (e) {
        console.error('[Worker] setAutoQuest off failed:', e);
      }
    });

    return { ok: true, message: '✅ Đã bật AutoQuest. Bot sẽ liên tục quét và hoàn thành quest.' };
  }

  private async runAutoQuestLoop(userId: string, token: string, dms: boolean, signal: AbortSignal) {
    const engine = new QuestEngine(token);
    const channel = await this.getNotiChannel();
    const progressMessages = new Map<string, string>(); // questId → messageId

    const lastStatus = new Map<string, string>();
    const onProgress: ProgressCallback = async (info) => {
      if (!channel) return;
      // Chỉ thông báo khi bắt đầu hoặc đổi trạng thái (không spam tiến độ từng giây)
      const prev = lastStatus.get(info.questId);
      const isStart = info.status === 'running' && !prev;
      const isEnd = info.status !== 'running' && prev !== info.status;
      if (!isStart && !isEnd) return;
      lastStatus.set(info.questId, info.status);

      try {
        const statusText =
          info.status === 'running'
            ? 'Đang thực hiện'
            : info.status === 'claimed'
              ? 'Đã nhận thưởng'
              : info.status === 'completed'
                ? 'Đã hoàn thành'
                : info.status === 'failed'
                  ? 'Thất bại'
                  : 'Bỏ qua';

        const embed = new EmbedBuilder()
          .setColor(
            info.status === 'claimed' || info.status === 'completed'
              ? 0x57f287
              : info.status === 'failed'
                ? 0xed4245
                : info.status === 'skipped'
                  ? 0x99aab5
                  : 0x5865f2,
          )
          .setTitle(info.questName.slice(0, 256))
          .setDescription(
            [
              `**${statusText}**`,
              `Người dùng: <@${userId}>`,
              info.message ? `Ghi chú: ${info.message}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          )
          .setTimestamp();

        const existing = progressMessages.get(info.questId);
        if (existing) {
          const msg = await channel.messages.fetch(existing).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed] });
            return;
          }
        }
        const sent = await channel.send({ embeds: [embed] });
        progressMessages.set(info.questId, sent.id);
      } catch { /* ignore */ }

      if (dms && (info.status === 'claimed' || info.status === 'failed')) {
        try {
          const user = await this.botClient.users.fetch(userId);
          await user
            .send({
              content:
                info.status === 'claimed'
                  ? `Quest **${info.questName}** đã claim xong.`
                  : `Quest **${info.questName}** thất bại${info.message ? `: ${info.message}` : ''}.`,
            })
            .catch(() => {});
        } catch { /* ignore */ }
      }
    };

    while (!signal.aborted) {
      try {
        await engine.runPending(onProgress, signal);
      } catch (err: any) {
        console.error(`[Worker ${userId}] loop error:`, err?.message);
      }
      // Wait 2 minutes before next full scan
      await new Promise((r) => {
        const t = setTimeout(r, 120_000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          r(null);
        }, { once: true });
      });
    }
  }

  /**
   * One-shot: run all pending then stop.
   */
  async runOnce(userId: string): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Đang có worker chạy. Hãy dừng trước.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token. Dùng `/token` trước.' };

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'auto', startedAt: Date.now() });

    const engine = new QuestEngine(token);
    const channel = await this.getNotiChannel();
    const progressMessages = new Map<string, string>();

    const onProgress: ProgressCallback = async (info) => {
      if (!channel) return;
      try {
        const embed = this.buildProgressEmbed(
          userId, info.questName, info.progress, info.target, info.status, info.message,
        );
        const existing = progressMessages.get(info.questId);
        if (existing) {
          const msg = await channel.messages.fetch(existing).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed] });
            return;
          }
        }
        const sent = await channel.send({ embeds: [embed] });
        progressMessages.set(info.questId, sent.id);
      } catch { /* ignore */ }
    };

    try {
      const results = await engine.runPending(onProgress, abort.signal);
      const summary = results.map((r) => `• ${r.quest.name}: **${r.result}**`).join('\n') || 'Không có quest pending.';
      return { ok: true, message: `✅ Đã chạy xong:\n${summary}` };
    } catch (err: any) {
      return { ok: false, message: `❌ Lỗi: ${err?.message || 'unknown'}` };
    } finally {
      activeWorkers.delete(userId);
    }
  }

  /**
   * Run specific quests by IDs.
   */
  async runSelected(userId: string, questIds: string[]): Promise<{ ok: boolean; message: string }> {
    if (activeWorkers.has(userId)) {
      return { ok: false, message: 'Đang có worker chạy. Hãy dừng trước.' };
    }

    const token = await this.getDecryptedToken(userId);
    if (!token) return { ok: false, message: 'Chưa khai báo token.' };

    const abort = new AbortController();
    activeWorkers.set(userId, { userId, abort, mode: 'quest', startedAt: Date.now() });

    const engine = new QuestEngine(token);
    const channel = await this.getNotiChannel();
    const progressMessages = new Map<string, string>();

    const onProgress: ProgressCallback = async (info) => {
      if (!channel) return;
      try {
        const embed = this.buildProgressEmbed(
          userId, info.questName, info.progress, info.target, info.status, info.message,
        );
        const existing = progressMessages.get(info.questId);
        if (existing) {
          const msg = await channel.messages.fetch(existing).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed] });
            return;
          }
        }
        const sent = await channel.send({ embeds: [embed] });
        progressMessages.set(info.questId, sent.id);
      } catch { /* ignore */ }
    };

    try {
      const all = await engine.loadQuests();
      const selected = all.filter((q) => questIds.includes(q.id));
      const results: string[] = [];

      for (const q of selected) {
        if (abort.signal.aborted) break;
        const result = await engine.execute(q, onProgress, abort.signal);
        results.push(`• ${q.name}: **${result}**`);
      }

      return { ok: true, message: `✅ Kết quả:\n${results.join('\n') || 'Không có quest nào được chọn.'}` };
    } catch (err: any) {
      return { ok: false, message: `❌ Lỗi: ${err?.message || 'unknown'}` };
    } finally {
      activeWorkers.delete(userId);
    }
  }

  /**
   * List pending quests for a user (for /quest select menu).
   */
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
