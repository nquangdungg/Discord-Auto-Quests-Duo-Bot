
function isJwtTimeError(msg: string): boolean {
  const m = (msg || '').toLowerCase();
  return m.includes('jwt issued at future') || m.includes('token used before') || m.includes('iat');
}

/**
 * Supabase (PostgreSQL) database layer
 * Tables: users, staff, servers, settings
 */
import type { UserRecord, StaffRecord, ServerRecord, StaffRole } from '../types';
import { initSupabase, getSupabase } from './supabase';

export function initDatabase(): void {
  initSupabase();
  console.log('[DB] Supabase ready');
}

function defaultUser(userId: string): UserRecord {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    encrypted_token: null,
    is_banned: 0,
    ban_reason: null,
    ban_expires_at: null,
    banned_by: null,
    banned_at: null,
    tos_accepted: 0,
    licensed: 0,
    license_key_id: null,
    autoquest_enabled: 0,
    dms_enabled: 0,
    created_at: now,
    updated_at: now,
  };
}

// ====================== USERS ======================
export const users = {
  async upsert(userId: string): Promise<void> {
    const sb = getSupabase();
    const { data } = await sb.from('users').select('user_id').eq('user_id', userId).maybeSingle();
    const now = new Date().toISOString();
    if (!data) {
      const { error } = await sb.from('users').insert(defaultUser(userId));
      if (error) throw new Error(`users.upsert insert: ${error.message}`);
    } else {
      const { error } = await sb.from('users').update({ updated_at: now }).eq('user_id', userId);
      if (error) throw new Error(`users.upsert update: ${error.message}`);
    }
  },

  async get(userId: string): Promise<UserRecord | undefined> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`users.get: ${error.message}`);
    return (data as UserRecord) ?? undefined;
  },

  async setToken(userId: string, encryptedToken: string): Promise<void> {
    await this.upsert(userId);
    const { error } = await getSupabase()
      .from('users')
      .update({ encrypted_token: encryptedToken, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw new Error(`users.setToken: ${error.message}`);
  },

  async setTosAccepted(userId: string, accepted: boolean): Promise<void> {
    await this.upsert(userId);
    const { error } = await getSupabase()
      .from('users')
      .update({ tos_accepted: accepted ? 1 : 0, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw new Error(`users.setTosAccepted: ${error.message}`);
  },

  async setLicensed(userId: string, licensed: boolean, keyId: string | null = null): Promise<void> {
    await this.upsert(userId);
    const { error } = await getSupabase()
      .from('users')
      .update({
        licensed: licensed ? 1 : 0,
        license_key_id: keyId,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (error) throw new Error(`users.setLicensed: ${error.message}`);
  },

  async setBanned(
    userId: string,
    banned: boolean,
    opts?: { reason?: string; expiresAt?: string | null; bannedBy?: string },
  ): Promise<void> {
    await this.upsert(userId);
    const now = new Date().toISOString();
    const payload = banned
      ? {
          is_banned: 1,
          licensed: 0,
          ban_reason: opts?.reason ?? 'Không có lý do',
          ban_expires_at: opts?.expiresAt ?? null,
          banned_by: opts?.bannedBy ?? null,
          banned_at: now,
          updated_at: now,
        }
      : {
          is_banned: 0,
          ban_reason: null,
          ban_expires_at: null,
          banned_by: null,
          banned_at: null,
          updated_at: now,
        };
    const { error } = await getSupabase().from('users').update(payload).eq('user_id', userId);
    if (error) throw new Error(`users.setBanned: ${error.message}`);
  },

  async refreshBanStatus(userId: string): Promise<boolean> {
    const u = await this.get(userId);
    if (!u || !u.is_banned) return false;
    if (u.ban_expires_at && new Date(u.ban_expires_at) <= new Date()) {
      await this.setBanned(userId, false);
      return true;
    }
    return false;
  },

  async getBanInfo(userId: string) {
    await this.refreshBanStatus(userId);
    const u = await this.get(userId);
    if (!u) return null;
    return {
      banned: !!u.is_banned,
      reason: u.ban_reason,
      expiresAt: u.ban_expires_at,
      bannedBy: u.banned_by,
      bannedAt: u.banned_at,
    };
  },

  async setAutoQuest(userId: string, enabled: boolean, dms: boolean): Promise<void> {
    await this.upsert(userId);
    const { error } = await getSupabase()
      .from('users')
      .update({
        autoquest_enabled: enabled ? 1 : 0,
        dms_enabled: dms ? 1 : 0,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (error) throw new Error(`users.setAutoQuest: ${error.message}`);
  },

  async canUseBot(userId: string): Promise<{ ok: boolean; reason?: string }> {
    const u = await this.get(userId);
    if (!u) return { ok: false, reason: 'Chưa đăng ký. Hãy dùng /agree trước.' };
    await this.refreshBanStatus(userId);
    const u2 = await this.get(userId);
    if (!u2) return { ok: false, reason: 'Chưa đăng ký. Hãy dùng /agree trước.' };
    if (u2.is_banned) {
      const until = u2.ban_expires_at
        ? `<t:${Math.floor(new Date(u2.ban_expires_at).getTime() / 1000)}:R>`
        : 'vĩnh viễn';
      const reason = [
        'Bạn đã bị cấm sử dụng bot.',
        `Lý do: ${u2.ban_reason || '—'}`,
        `Hết hạn: ${until}`,
        u2.banned_by ? `Người cấm: <@${u2.banned_by}>` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return { ok: false, reason };
    }
    if (!u2.tos_accepted) {
      return { ok: false, reason: 'Bạn chưa chấp nhận Điều khoản sử dụng.' };
    }
    return { ok: true };
  },

  async getAllAutoQuestUsers(): Promise<UserRecord[]> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('autoquest_enabled', 1)
      .eq('is_banned', 0)
      .eq('tos_accepted', 1)
      .not('encrypted_token', 'is', null);
    if (error) throw new Error(`users.getAllAutoQuestUsers: ${error.message}`);
    return (data as UserRecord[]) || [];
  },

  /** User đã agree + có token + không ban — dùng cho scan quest mới */
  async getTrackedUsers(): Promise<UserRecord[]> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('is_banned', 0)
      .eq('tos_accepted', 1)
      .not('encrypted_token', 'is', null);
    if (error) throw new Error(`users.getTrackedUsers: ${error.message}`);
    return (data as UserRecord[]) || [];
  },
};

// ====================== STAFF ======================
export const staff = {
  async add(userId: string, role: StaffRole, addedBy: string): Promise<void> {
    const row: StaffRecord = {
      user_id: userId,
      role,
      added_by: addedBy,
      added_at: new Date().toISOString(),
    };
    const { error } = await getSupabase().from('staff').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(`staff.add: ${error.message}`);
  },

  async remove(userId: string): Promise<void> {
    const { error } = await getSupabase().from('staff').delete().eq('user_id', userId);
    if (error) throw new Error(`staff.remove: ${error.message}`);
  },

  async get(userId: string): Promise<StaffRecord | undefined> {
    const { data, error } = await getSupabase()
      .from('staff')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`staff.get: ${error.message}`);
    return (data as StaffRecord) ?? undefined;
  },

  async isOwner(userId: string): Promise<boolean> {
    if (userId === process.env.OWNER_ID) return true;
    const s = await this.get(userId);
    return s?.role === 'owner';
  },

  async isAdminOrOwner(userId: string): Promise<boolean> {
    if (userId === process.env.OWNER_ID) return true;
    const s = await this.get(userId);
    return s?.role === 'owner' || s?.role === 'admin';
  },

  async list(): Promise<StaffRecord[]> {
    const { data, error } = await getSupabase().from('staff').select('*');
    if (error) throw new Error(`staff.list: ${error.message}`);
    return (data as StaffRecord[]) || [];
  },
};

// ====================== SERVERS ======================
export const servers = {
  async add(guildId: string, addedBy: string): Promise<void> {
    const existing = await this.isAllowed(guildId);
    if (existing) return;
    const row: ServerRecord = {
      guild_id: guildId,
      added_by: addedBy,
      added_at: new Date().toISOString(),
    };
    const { error } = await getSupabase().from('servers').insert(row);
    if (error) throw new Error(`servers.add: ${error.message}`);
  },

  async remove(guildId: string): Promise<void> {
    const { error } = await getSupabase().from('servers').delete().eq('guild_id', guildId);
    if (error) throw new Error(`servers.remove: ${error.message}`);
  },

  async isAllowed(guildId: string): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('servers')
      .select('guild_id')
      .eq('guild_id', guildId)
      .maybeSingle();
    if (error) {
      if (isJwtTimeError(error.message)) {
        console.error(
          '[DB] JWT time error (đồng hồ máy/container lệch). ' +
            'Đồng bộ NTP rồi restart. Chi tiết:',
          error.message,
        );
        // Fail-open tạm: không đá server khi DB lỗi đồng hồ (tránh crash bot)
        return true;
      }
      throw new Error(`servers.isAllowed: ${error.message}`);
    }
    return !!data;
  },

  async list(): Promise<ServerRecord[]> {
    const { data, error } = await getSupabase().from('servers').select('*');
    if (error) throw new Error(`servers.list: ${error.message}`);
    return (data as ServerRecord[]) || [];
  },
};

// ====================== SETTINGS ======================
export const settings = {
  async get(key: string): Promise<string | null> {
    const { data, error } = await getSupabase()
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(`settings.get: ${error.message}`);
    return data?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const { error } = await getSupabase()
      .from('settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new Error(`settings.set: ${error.message}`);
  },
};

export default { users, staff, servers, settings, initDatabase };
