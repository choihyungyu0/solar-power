import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function hasRealValue(value: string | undefined) {
  return Boolean(value && !value.includes('your-') && !value.includes('your_') && value.trim().length > 12);
}

export const isSupabaseConfigured = hasRealValue(supabaseUrl) && hasRealValue(supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
