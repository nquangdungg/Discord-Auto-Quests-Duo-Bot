export type StaffRole = 'owner' | 'admin';

export interface UserRecord {
  user_id: string;
  encrypted_token: string | null;
  is_banned: number;          // 0 | 1
  tos_accepted: number;       // 0 | 1
  licensed: number;           // 0 | 1
  license_key_id: string | null;
  autoquest_enabled: number;  // 0 | 1
  dms_enabled: number;        // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface StaffRecord {
  user_id: string;
  role: StaffRole;
  added_by: string;
  added_at: string;
}

export interface ServerRecord {
  guild_id: string;
  added_by: string;
  added_at: string;
}

export interface LicenseKeyRecord {
  id: string;                 // internal id
  raw_payload: string;        // original 32-char payload (encrypted in DB too if needed)
  encrypted_key: string;      // the key shown to admin
  created_by: string;
  created_at: string;
  expires_at: string;         // created_at + 5 minutes
  used_by: string | null;
  used_at: string | null;
  status: 'unused' | 'used' | 'expired' | 'revoked';
}

export interface SettingRecord {
  key: string;
  value: string;
}

export interface QuestProgressEmbed {
  userId: string;
  messageId: string;
  channelId: string;
  questId: string;
  lastUpdate: number;
}
