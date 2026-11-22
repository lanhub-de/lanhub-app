'use server';
import { supabaseServer } from '@/lib/supabase/server';

// The email code is checked on the server, so the sign-in cookies are set by
// the server and last (Safari cuts cookies written by page scripts to 7 days).
// After that the device stays signed in: no code, no password.
export async function verifyCode(email: string, code: string): Promise<string | null> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    email: String(email).trim().toLowerCase(), token: String(code).trim(), type: 'email',
  });
  return error ? error.message : null;
}
