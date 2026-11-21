'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

// Password sign-in on the server, so the sign-in cookies are set by the server
// and last (Safari shortens cookies written by page scripts).
export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const lang = formData.get('lang') === 'uk' ? '&lang=uk' : '';
  if (!email || !password) redirect(`/login?mode=password&e=pw${lang}`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?mode=password&e=pw${lang}`);
  redirect('/');
}
