-- Chạy trong Supabase Dashboard → SQL Editor → New query

create table if not exists users (
  user_id text primary key,
  encrypted_token text,
  is_banned int not null default 0,
  ban_reason text,
  ban_expires_at timestamptz,
  banned_by text,
  banned_at timestamptz,
  tos_accepted int not null default 0,
  licensed int not null default 0,
  license_key_id text,
  autoquest_enabled int not null default 0,
  dms_enabled int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff (
  user_id text primary key,
  role text not null check (role in ('owner', 'admin')),
  added_by text not null,
  added_at timestamptz not null default now()
);

create table if not exists servers (
  guild_id text primary key,
  added_by text not null,
  added_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- Bot dùng service_role key → bypass RLS.
-- Vẫn nên bật RLS và không expose service_role ra client.
alter table users enable row level security;
alter table staff enable row level security;
alter table servers enable row level security;
alter table settings enable row level security;
