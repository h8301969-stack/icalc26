import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;

// Use placeholder strings to prevent initialization errors if environment variables are missing.
// createClient throws an error if the URL is an empty string.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co',
  supabaseKey || 'placeholder'
);

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) are missing. Network calls will fail.");
}

export default supabase;