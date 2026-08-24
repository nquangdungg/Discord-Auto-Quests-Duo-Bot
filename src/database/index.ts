/**
 * Lightweight JSON database (no native deps).
 * Sensitive fields (tokens) are stored already encrypted by the crypto layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  UserRecord,
  StaffRecord,
  ServerRecord,
  LicenseKeyRecord,
  StaffRole,
} from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'hieutool.json');

interface DbShape {
  users: Record<string, UserRecord>;
  staff: Record<string, StaffRecord>;
  servers: Record<string, ServerRecord>;
  license_keys: Record<string, LicenseKeyRecord>;
  settings: Record<string, string>;
}

function emptyDb(): DbShape {
  return { users: {}, staff: {}, servers: {}, license_keys: {}, settings: {} };
}

function load(): DbShape {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = emptyDb();
    save(db);
    return db;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as DbShape;
  } catch {
    return emptyDb();
  }
}

function save(db: DbShape): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

let cache = load();

function persist() {
  save(cache);
}

export const users = {
  upsert(userId: string): void {
    const now = new Date().toISOString();
    if (!cache.users[userId]) {
      cache.users[userId] = {
        user_id: userId,
        encrypted_token: null,
        is_banned: 0,
        tos_accepted: 0,
        licensed: 0,
        license_key_id: null,
        autoquest_enabled: 0,
        dms_enabled: 0,
        created_at: now,
        updated_at: now,
      };
    } else {
      cache.users[userId].updated_at = now;
    }
    persist();
  },

  get(userId: string): UserRecord | undefined {
    return cache.users[userId];
  },

  setToken(userId: string, encryptedToken: string): void {
    this.upsert(userId);
    cache.users[userId].encrypted_token = encryptedToken;
    cache.users[userId].updated_at = new Date().toISOString();
    persist();
  },

  setTosAccepted(userId: string, accepted: boolean): void {
    this.upsert(userId);
    cache.users[userId].tos_accepted = accepted ? 1 : 0;
    cache.users[userId].updated_at = new Date().toISOString();
    persist();
  },

  setLicensed(userId: string, licensed: boolean, keyId: string | null = null): void {
    this.upsert(userId);
    cache.users[userId].licensed = licensed ? 1 : 0;
    cache.users[userId].license_key_id = keyId;
    cache.users[userId].updated_at = new Date().toISOString();
    persist();
  },

  setBanned(userId: string, banned: boolean): void {
    this.upsert(userId);
    cache.users[userId].is_banned = banned ? 1 : 0;
    if (banned) cache.users[userId].licensed = 0;
    cache.users[userId].updated_at = new Date().toISOString();
    persist();
  },

  setAutoQuest(userId: string, enabled: boolean, dms: boolean): void {
    this.upsert(userId);
    cache.users[userId].autoquest_enabled = enabled ? 1 : 0;
    cache.users[userId].dms_enabled = dms ? 1 : 0;
    cache.users[userId].updated_at = new Date().toISOString();
    persist();
  },

  canUseBot(userId: string): { ok: boolean; reason?: string } {
    const u = this.get(userId);
    if (!u) return { ok: false, reason: 'Chưa đăng ký. Hãy dùng /agree trước.' };
    if (u.is_banned) return { ok: false, reason: 'Tài khoản của bạn đã bị cấm sử dụng bot.' };
    if (!u.tos_accepted) return { ok: false, reason: 'Bạn chưa chấp nhận Điều khoản sử dụng.' };
    return { ok: true };
  },

  getAllAutoQuestUsers(): UserRecord[] {
    return Object.values(cache.users).filter(
      (u) =>
        u.autoquest_enabled === 1 &&
        u.is_banned === 0 &&
        u.tos_accepted === 1 &&
        !!u.encrypted_token,
    );
  },
};

export const staff = {
  add(userId: string, role: StaffRole, addedBy: string): void {
    cache.staff[userId] = {
      user_id: userId,
      role,
      added_by: addedBy,
      added_at: new Date().toISOString(),
    };
    persist();
  },

  remove(userId: string): void {
    delete cache.staff[userId];
    persist();
  },

  get(userId: string): StaffRecord | undefined {
    return cache.staff[userId];
  },

  isOwner(userId: string): boolean {
    if (userId === process.env.OWNER_ID) return true;
    return this.get(userId)?.role === 'owner';
  },

  isAdminOrOwner(userId: string): boolean {
    if (userId === process.env.OWNER_ID) return true;
    const s = this.get(userId);
    return s?.role === 'owner' || s?.role === 'admin';
  },

  list(): StaffRecord[] {
    return Object.values(cache.staff);
  },
};

export const servers = {
  add(guildId: string, addedBy: string): void {
    if (cache.servers[guildId]) return;
    cache.servers[guildId] = {
      guild_id: guildId,
      added_by: addedBy,
      added_at: new Date().toISOString(),
    };
    persist();
  },

  remove(guildId: string): void {
    delete cache.servers[guildId];
    persist();
  },

  isAllowed(guildId: string): boolean {
    return !!cache.servers[guildId];
  },

  list(): ServerRecord[] {
    return Object.values(cache.servers);
  },
};

export const keys = {
  create(id: string, rawPayload: string, encryptedKey: string, createdBy: string): LicenseKeyRecord {
    const now = new Date();
    const expires = new Date(now.getTime() + 5 * 60 * 1000);

    const record: LicenseKeyRecord = {
      id,
      raw_payload: rawPayload,
      encrypted_key: encryptedKey,
      created_by: createdBy,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      used_by: null,
      used_at: null,
      status: 'unused',
    };

    cache.license_keys[id] = record;
    persist();
    return record;
  },

  findByEncrypted(encryptedKey: string): LicenseKeyRecord | undefined {
    return Object.values(cache.license_keys).find((k) => k.encrypted_key === encryptedKey);
  },

  markUsed(id: string, usedBy: string): void {
    const k = cache.license_keys[id];
    if (!k) return;
    k.status = 'used';
    k.used_by = usedBy;
    k.used_at = new Date().toISOString();
    persist();
  },

  expireOldKeys(): number {
    const now = new Date().toISOString();
    let n = 0;
    for (const k of Object.values(cache.license_keys)) {
      if (k.status === 'unused' && k.expires_at < now) {
        k.status = 'expired';
        n++;
      }
    }
    if (n > 0) persist();
    return n;
  },

  get(id: string): LicenseKeyRecord | undefined {
    return cache.license_keys[id];
  },
};

export const settings = {
  get(key: string): string | null {
    return cache.settings[key] ?? null;
  },

  set(key: string, value: string): void {
    cache.settings[key] = value;
    persist();
  },
};

setInterval(() => keys.expireOldKeys(), 30_000);

export default { users, staff, servers, keys, settings };
