import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Public publishable project defaults (same as `.env.example`).
 * Used when VITE_* was not baked into the build (common APK CI miss).
 * Publishable keys are safe to ship in the client; never put service_role here.
 */
const DEFAULT_SUPABASE_URL = 'https://ttwgosajvcdyybkwdgdo.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_kUALsINgJKZ3DJkeszUTeQ_KAaWuKjL';

const envUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const envKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

const supabaseUrl =
  envUrl && !envUrl.includes('your-project') ? envUrl : DEFAULT_SUPABASE_URL;
const supabaseKey = envKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = (): boolean =>
  !!supabaseUrl &&
  !!supabaseKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseUrl.includes('placeholder');

/** Cloud data sync on production builds (Vercel, Netlify, APK). Auth works whenever configured. */
export const isCloudBackendEnabled = (): boolean =>
  isSupabaseConfigured() && import.meta.env.PROD;

let client: SupabaseClient | null = null;

export const supabase: SupabaseClient = (() => {
  if (!isSupabaseConfigured()) {
    return createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
})();
