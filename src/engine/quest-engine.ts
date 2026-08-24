/**
 * Quest Engine – REST ONLY (user token / selfbot-style API calls)
 *
 * QUAN TRỌNG – TÁCH BIỆT THƯ VIỆN:
 * - File này KHÔNG import @discordjs/ws, KHÔNG patch WebSocketShard.
 * - Bot Discord (bot1/bot2) dùng discord.js riêng, không bị nhiễm.
 * - Chỉ gọi REST API với user token để làm quest (giống bản gốc farm).
 */
import { randomUUID } from 'node:crypto';

export type Snowflake = string;

export enum TaskType {
  WATCH_VIDEO = 'WATCH_VIDEO',
  PLAY_ON_DESKTOP = 'PLAY_ON_DESKTOP',
  STREAM_ON_DESKTOP = 'STREAM_ON_DESKTOP',
  PLAY_ACTIVITY = 'PLAY_ACTIVITY',
  WATCH_VIDEO_ON_MOBILE = 'WATCH_VIDEO_ON_MOBILE',
  PLAY_ON_XBOX = 'PLAY_ON_XBOX',
  PLAY_ON_PLAYSTATION = 'PLAY_ON_PLAYSTATION',
}

export interface QuestTask {
  event_name: string;
  target: number;
  external_ids?: string[];
  title?: string;
  description?: string;
}

export interface QuestData {
  id: Snowflake;
  config: {
    id: Snowflake;
    starts_at: string;
    expires_at: string;
    application: { id: Snowflake; name: string; link: string };
    messages: { quest_name: string; game_title: string; game_publisher: string };
    task_config?: { tasks: Record<string, QuestTask> };
    task_config_v2?: {
      tasks: Record<string, QuestTask & { type?: string; applications?: { id: string }[] }>;
    };
    rewards_config: {
      rewards: Array<{
        orb_quantity?: number;
        quantity?: number;
        messages?: { name: string };
      }>;
    };
  };
  user_status: {
    user_id: Snowflake;
    enrolled_at: string | null;
    completed_at: string | null;
    claimed_at: string | null;
    progress: Record<string, { event_name: string; value: number; completed_at: string | null }>;
  } | null;
  preview: boolean;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

function buildClientProps() {
  return {
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: '1.0.9215',
    os_version: '10.0.19045',
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'en-US',
    has_client_mods: false,
    client_launch_id: randomUUID(),
    browser_user_agent: USER_AGENT,
    browser_version: '37.6.0',
    os_sdk_version: '19045',
    client_build_number: 471091,
    native_build_number: 72186,
    client_event_source: null,
    launch_signature: randomUUID(),
    client_heartbeat_session_id: randomUUID(),
    client_app_state: 'focused',
  };
}

/** Pure fetch wrapper for Discord API with user token – NO Gateway */
async function discordApi<T = unknown>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: token.replace(/^Bot\s+/i, ''),
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Accept-Language': 'vi',
    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
    'X-Discord-Locale': 'en-US',
    'X-Discord-Timezone': 'Asia/Saigon',
    'X-Debug-Options': 'bugReporterEnabled',
    'X-Super-Properties': Buffer.from(JSON.stringify(buildClientProps())).toString('base64'),
  };

  const res = await fetch(`https://discord.com/api/v9${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord API ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class Quest {
  constructor(public raw: QuestData) {}

  static from(raw: QuestData) {
    return new Quest(raw);
  }

  get id() {
    return this.raw.id;
  }
  get name() {
    return this.raw.config.messages.quest_name?.trim() || this.id;
  }
  get userStatus() {
    return this.raw.user_status;
  }

  isExpired(now = new Date()) {
    return now.getTime() > new Date(this.raw.config.expires_at).getTime();
  }
  isCompleted() {
    return Boolean(this.userStatus?.completed_at);
  }
  isEnrolled() {
    return Boolean(this.userStatus?.enrolled_at);
  }
  isClaimed() {
    return Boolean(this.userStatus?.claimed_at);
  }

  refreshStatus(status: QuestData['user_status']) {
    this.raw.user_status = status;
  }

  private getTasks(): Record<string, QuestTask> | null {
    return (this.raw.config.task_config_v2?.tasks ?? this.raw.config.task_config?.tasks ?? null) as any;
  }

  detectTaskType(): TaskType | null {
    const tasks = this.getTasks();
    if (!tasks) return null;
    const priority = [
      TaskType.PLAY_ON_DESKTOP,
      TaskType.WATCH_VIDEO,
      TaskType.WATCH_VIDEO_ON_MOBILE,
      TaskType.STREAM_ON_DESKTOP,
      TaskType.PLAY_ACTIVITY,
      TaskType.PLAY_ON_XBOX,
      TaskType.PLAY_ON_PLAYSTATION,
    ];
    return priority.find((t) => tasks[t] != null) ?? null;
  }

  getTarget(): number {
    const t = this.detectTaskType();
    if (!t) return 900;
    return this.getTasks()?.[t]?.target ?? 900;
  }

  getProgress(): number {
    const t = this.detectTaskType();
    if (!t) return 0;
    return this.userStatus?.progress?.[t]?.value ?? 0;
  }

  getRemaining(): number {
    return Math.max(0, this.getTarget() - this.getProgress());
  }

  getRewardLabel(): string {
    const rewards = this.raw.config.rewards_config?.rewards;
    if (!rewards?.length) return 'Unknown';
    if (rewards[0].orb_quantity) return `${rewards[0].orb_quantity} Orbs`;
    return rewards[0].messages?.name ?? 'Unknown';
  }

  get taskIcon(): string {
    switch (this.detectTaskType()) {
      case TaskType.WATCH_VIDEO:
      case TaskType.WATCH_VIDEO_ON_MOBILE:
        return '🎬';
      case TaskType.PLAY_ON_DESKTOP:
        return '🎮';
      case TaskType.STREAM_ON_DESKTOP:
        return '📡';
      case TaskType.PLAY_ACTIVITY:
        return '🕹️';
      default:
        return '❓';
    }
  }
}

export type ProgressCallback = (info: {
  questId: string;
  questName: string;
  progress: number;
  target: number;
  remaining: number;
  status: 'running' | 'completed' | 'claimed' | 'failed' | 'skipped';
  message?: string;
}) => void | Promise<void>;

/** REST-only. Không mở Gateway, không đụng @discordjs/ws. */
export class QuestEngine {
  constructor(private token: string) {}

  async getBalance(): Promise<number> {
    try {
      const res = await discordApi<{ balance: number }>(
        this.token,
        'GET',
        '/users/@me/virtual-currency/balance',
      );
      return res.balance ?? 0;
    } catch {
      return 0;
    }
  }

  async loadQuests(): Promise<Quest[]> {
    const res = await discordApi<{ quests: QuestData[] }>(this.token, 'GET', '/quests/@me');
    return (res.quests || []).map((q) => Quest.from(q));
  }

  async enroll(questId: string): Promise<any> {
    return discordApi(this.token, 'POST', `/quests/${questId}/enroll`, {
      location: 11,
      is_targeted: false,
      metadata_raw: null,
    });
  }

  async claimReward(questId: string): Promise<any> {
    return discordApi(this.token, 'POST', `/quests/${questId}/claim-reward`, {});
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async execute(
    quest: Quest,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<'claimed' | 'failed' | 'skipped'> {
    const taskType = quest.detectTaskType();
    if (!taskType) {
      await onProgress?.({
        questId: quest.id,
        questName: quest.name,
        progress: 0,
        target: 0,
        remaining: 0,
        status: 'skipped',
        message: 'Loại quest chưa hỗ trợ',
      });
      return 'skipped';
    }

    try {
      if (!quest.isEnrolled()) {
        const status = await this.enroll(quest.id);
        quest.refreshStatus(status as any);
      }

      const target = quest.getTarget();
      let done = quest.getProgress();

      await onProgress?.({
        questId: quest.id,
        questName: quest.name,
        progress: done,
        target,
        remaining: Math.max(0, target - done),
        status: 'running',
      });

      if (taskType === TaskType.WATCH_VIDEO || taskType === TaskType.WATCH_VIDEO_ON_MOBILE) {
        const enrolledAt = new Date(quest.userStatus?.enrolled_at as any).getTime();
        let finished = false;

        while (!signal?.aborted) {
          const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + 10;
          const next = done + 7;

          if (maxAllowed - done >= 7) {
            const res = (await discordApi(this.token, 'POST', `/quests/${quest.id}/video-progress`, {
              timestamp: Math.min(target, next + Math.random()),
            })) as any;
            finished = res?.completed_at != null;
            done = Math.min(target, next);

            await onProgress?.({
              questId: quest.id,
              questName: quest.name,
              progress: done,
              target,
              remaining: Math.max(0, target - done),
              status: finished ? 'completed' : 'running',
            });
          }

          if (next >= target) break;
          await this.sleep(1000);
        }

        if (!finished && !signal?.aborted) {
          await discordApi(this.token, 'POST', `/quests/${quest.id}/video-progress`, {
            timestamp: target,
          });
        }
      } else if (taskType === TaskType.PLAY_ON_DESKTOP) {
        const taskDef = (quest.raw.config.task_config_v2?.tasks ?? quest.raw.config.task_config?.tasks)?.[
          TaskType.PLAY_ON_DESKTOP
        ] as any;
        const appId = taskDef?.applications?.[0]?.id ?? quest.raw.config.application.id;

        while (!quest.isCompleted() && !signal?.aborted) {
          const res = await discordApi(this.token, 'POST', `/quests/${quest.id}/heartbeat`, {
            application_id: appId,
            terminal: false,
          });
          quest.refreshStatus(res as any);
          done = quest.getProgress();

          await onProgress?.({
            questId: quest.id,
            questName: quest.name,
            progress: done,
            target,
            remaining: Math.max(0, target - done),
            status: quest.isCompleted() ? 'completed' : 'running',
          });

          if (quest.isCompleted()) break;
          await this.sleep(60_000);
        }

        if (!signal?.aborted) {
          const res = await discordApi(this.token, 'POST', `/quests/${quest.id}/heartbeat`, {
            application_id: appId,
            terminal: true,
          });
          quest.refreshStatus(res as any);
        }
      } else {
        await onProgress?.({
          questId: quest.id,
          questName: quest.name,
          progress: 0,
          target: 0,
          remaining: 0,
          status: 'skipped',
          message: `Loại ${taskType} chưa hỗ trợ`,
        });
        return 'skipped';
      }

      if (signal?.aborted) return 'failed';

      try {
        await this.claimReward(quest.id);
        await onProgress?.({
          questId: quest.id,
          questName: quest.name,
          progress: target,
          target,
          remaining: 0,
          status: 'claimed',
        });
        return 'claimed';
      } catch {
        await onProgress?.({
          questId: quest.id,
          questName: quest.name,
          progress: target,
          target,
          remaining: 0,
          status: 'completed',
          message: 'Hoàn thành nhưng claim lỗi (có thể đã claim rồi)',
        });
        return 'claimed';
      }
    } catch (err: any) {
      await onProgress?.({
        questId: quest.id,
        questName: quest.name,
        progress: quest.getProgress(),
        target: quest.getTarget(),
        remaining: quest.getRemaining(),
        status: 'failed',
        message: err?.message?.slice(0, 80) || 'Unknown error',
      });
      return 'failed';
    }
  }

  async runPending(
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<{ quest: Quest; result: string }[]> {
    const all = await this.loadQuests();
    const pending = all.filter(
      (q) => q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired(),
    );

    for (const q of all.filter((q) => q.isCompleted() && !q.isClaimed())) {
      try {
        await this.claimReward(q.id);
        await onProgress?.({
          questId: q.id,
          questName: q.name,
          progress: q.getTarget(),
          target: q.getTarget(),
          remaining: 0,
          status: 'claimed',
          message: 'Claim reward còn thiếu',
        });
      } catch {
        /* ignore */
      }
    }

    const results: { quest: Quest; result: string }[] = [];
    for (const q of pending) {
      if (signal?.aborted) break;
      const result = await this.execute(q, onProgress, signal);
      results.push({ quest: q, result });
    }
    return results;
  }
}
