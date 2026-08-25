export type StaffRole = 'owner' | 'admin';

export interface UserRecord {
  user_id: string;
  encrypted_token: string | null;
  is_banned: number;
  ban_reason: string | null;
  ban_expires_at: string | null;
  banned_by: string | null;
  banned_at: string | null;
  tos_accepted: number;
  licensed: number;
  license_key_id: string | null;
  autoquest_enabled: number;
  dms_enabled: number;
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
  id: string;
  raw_payload: string;
  encrypted_key: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  status: 'unused' | 'used' | 'expired' | 'revoked';
}

export interface SettingRecord {
  key: string;
  value: string;
}
