import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = (): boolean =>
  !!supabaseUrl && !!supabaseKey && !supabaseUrl.includes('your-project');

/**
 * Cloud data sync whenever Supabase env is present (web, APK, or local .env.local).
 * Previously gated on PROD only — login could succeed while sync stayed off, so every
 * re-login wiped local state and never restored from the same database.
 */
export const isCloudBackendEnabled = (): boolean => isSupabaseConfigured();

let client: SupabaseClient | null = null;

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  // Capacitor / APK: don't treat deep-link URL noise as a sign-out.
  detectSessionInUrl: false,
} as const;

export const supabase: SupabaseClient = (() => {
  if (!isSupabaseConfigured()) {
    return createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: authOptions,
    });
  }
  if (!client) {
    client = createClient(supabaseUrl!, supabaseKey!, {
      auth: authOptions,
    });
  }
  return client;
})();
