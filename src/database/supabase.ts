import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function initSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env\n' +
        'Lấy tại: Supabase Dashboard → Project Settings → API',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function getSupabase(): SupabaseClient {
  if (!client) return initSupabase();
  return client;
}
