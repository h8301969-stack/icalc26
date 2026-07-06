import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = (): boolean =>
  !!supabaseUrl && !!supabaseKey && !supabaseUrl.includes('your-project');

/** Cloud auth + data sync only on production builds (Vercel, Netlify, etc.). Local `npm run dev` uses browser storage. */
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
    client = createClient(supabaseUrl!, supabaseKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
})();