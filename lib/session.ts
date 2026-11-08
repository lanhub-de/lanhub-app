import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { translator, type Locale } from './i18n';

export type Role = 'owner' | 'head_teacher' | 'manager' | 'teacher' | 'student';

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  locale: Locale;
  viewer_code: string;
};

// The signed-in person and a translator in their language. Anyone signed in
// without a profile (not invited) goes to the no-access page.
export async function requireProfile(allowed?: Role[]) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, locale, viewer_code')
    .eq('id', uid)
    .maybeSingle<Profile>();
  if (!profile) redirect('/no-access');
  if (allowed && !allowed.includes(profile.role)) redirect('/');
  return { supabase, profile, t: translator(profile.locale) };
}

export const STAFF: Role[] = ['owner', 'head_teacher', 'manager'];
export const TEACHING: Role[] = ['owner', 'head_teacher', 'teacher'];
