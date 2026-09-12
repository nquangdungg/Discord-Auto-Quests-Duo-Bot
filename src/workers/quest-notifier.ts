import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { users, settings } from '../database';
import { decrypt } from '../utils/crypto';
import { QuestEngine, Quest, TaskType } from '../engine/quest-engine';

const POLL_MS = Number(process.env.QUEST_NOTIFY_INTERVAL_MS) || 5 * 60 * 1000;
const KNOWN_KEY = 'known_quest_ids';

function taskLabel(q: Quest): string {
  const t = q.detectTaskType();
  switch (t) {
    case TaskType.WATCH_VIDEO:
    case TaskType.WATCH_VIDEO_ON_MOBILE:
      return `Watch video ~${Math.ceil(q.getTarget() / 60)} min`;
    case TaskType.PLAY_ON_DESKTOP:
      return `Play on Desktop ~${Math.ceil(q.getTarget() / 60)} min`;
    case TaskType.STREAM_ON_DESKTOP:
      return 'Stream on Desktop';
    case TaskType.PLAY_ACTIVITY:
      return 'Play Activity';
    default:
      return t ? String(t) : 'Special task';
  }
}

export class QuestNotifier {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private channelCache: { id: string; ch: TextChannel; at: number } | null = null;
  private knownMem: Set<string> | null = null;
  private tokenMem: { token: string; at: number } | null = null;

  constructor(private botClient: Client) {}

  start(): void {
    if (this.timer) return;
    console.log(`[Notifier] Poll every ${POLL_MS / 1000}s`);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async getNotifyChannel(): Promise<TextChannel | null> {
    if (this.channelCache && Date.now() - this.channelCache.at < 120_000) {
      return this.channelCache.ch;
    }
    const id = await settings.get('notification_channel');
    if (!id) return null;
    try {
      const ch = await this.botClient.channels.fetch(id);
      if (ch?.isTextBased()) {
        this.channelCache = { id, ch: ch as TextChannel, at: Date.now() };
        return this.channelCache.ch;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private async pickToken(): Promise<string | null> {
    if (this.tokenMem && Date.now() - this.tokenMem.at < 300_000) {
      return this.tokenMem.token;
    }
    const list = await users.getTrackedUsers();
    for (const u of list) {
      if (!u.encrypted_token) continue;
      try {
        const token = decrypt(u.encrypted_token);
        this.tokenMem = { token, at: Date.now() };
        return token;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async loadKnown(): Promise<Set<string>> {
    if (this.knownMem) return this.knownMem;
    const raw = await settings.get(KNOWN_KEY);
    if (!raw) {
      this.knownMem = new Set();
      return this.knownMem;
    }
    try {
      const arr = JSON.parse(raw) as string[];
      this.knownMem = new Set(Array.isArray(arr) ? arr : []);
    } catch {
      this.knownMem = new Set();
    }
    return this.knownMem;
  }

  private async saveKnown(ids: Set<string>): Promise<void> {
    this.knownMem = ids;
    await settings.set(KNOWN_KEY, JSON.stringify([...ids]));
  }

  /**
   * /test — quest active mới nhất → kênh notification (embed + @everyone thật).
   */
  async testNearestQuest(userId: string): Promise<{ ok: boolean; message: string }> {
    const channel = await this.getNotifyChannel();
    if (!channel) {
      return { ok: false, message: 'Chưa set kênh `/notification`.' };
    }

    let token: string | null = null;
    try {
      const u = await users.get(userId);
      if (u?.encrypted_token) token = decrypt(u.encrypted_token);
    } catch {
      /* ignore */
    }
    if (!token) token = await this.pickToken();
    if (!token) {
      return {
        ok: false,
        message: 'Không có token để load quest (owner cần `/token` hoặc có user tracked).',
      };
    }

    const engine = new QuestEngine(token);
    const quests = await engine.loadQuests();
    const active = quests
      .filter((q) => !q.isExpired() && q.id !== '1412491570820812933')
      .sort((a, b) => {
        const sa = new Date(a.raw.config.starts_at || 0).getTime();
        const sb = new Date(b.raw.config.starts_at || 0).getTime();
        return sb - sa;
      });

    if (!active.length) {
      return { ok: false, message: 'Không có quest active để test.' };
    }

    const q = active[0];
    await this.announce(channel, q);
    return {
      ok: true,
      message: `Đã gửi quest **${q.name}** (\`${q.id}\`) vào kênh notification.`,
    };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const channel = await this.getNotifyChannel();
      if (!channel) return;

      const token = await this.pickToken();
      if (!token) return;

      const engine = new QuestEngine(token);
      const quests = await engine.loadQuests();
      const active = quests.filter((q) => !q.isExpired() && q.id !== '1412491570820812933');

      const known = await this.loadKnown();
      const isFirstRun = known.size === 0;
      const nowIds = new Set(active.map((q) => q.id));

      if (isFirstRun) {
        await this.saveKnown(nowIds);
        console.log(`[Notifier] Seed ${nowIds.size} quest id(s)`);
        return;
      }

      const fresh = active.filter((q) => !known.has(q.id));
      for (let i = 0; i < fresh.length; i += 3) {
        await Promise.all(fresh.slice(i, i + 3).map((q) => this.announce(channel, q)));
      }

      for (const id of nowIds) known.add(id);
      await this.saveKnown(known);
    } catch (e: any) {
      console.error('[Notifier]', e?.message || e);
    } finally {
      this.running = false;
    }
  }

  private async announce(channel: TextChannel, q: Quest): Promise<void> {
    const reward = q.getRewardLabel();
    const ends = q.raw.config.expires_at
      ? `<t:${Math.floor(new Date(q.raw.config.expires_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(q.raw.config.expires_at).getTime() / 1000)}:R>)`
      : '—';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: 'Auto Quests Bot' })
      .setTitle('🎤 New Discord Quest Available!')
      .setDescription(`**${q.name}**`)
      .addFields(
        { name: '🎁 Reward', value: `**${reward}**`, inline: false },
        { name: '⏰ Ends', value: ends, inline: false },
        { name: 'Quest ID', value: `\`${q.id}\``, inline: false },
        {
          name: '✅ How to claim',
          value: [`**${taskLabel(q)}**`, 'Use `/auto` or `/quest` to complete automatically!'].join(
            '\n',
          ),
          inline: false,
        },
      )
      .setFooter({ text: 'Auto Quests Bot' })
      .setTimestamp();

    await channel.send({
      content: '@everyone',
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    });
    console.log(`[Notifier] Announced ${q.id} — ${q.name}`);
  }
}
