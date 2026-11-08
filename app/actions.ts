'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function saveSettings(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const locale = formData.get('locale') === 'en' ? 'en' : 'uk';
  const fullName = String(formData.get('full_name') ?? '').trim();
  const update: Record<string, string> = { locale };
  if (fullName) update.full_name = fullName;
  let { error } = await supabase.from('profiles').update(update).eq('id', user.id);
  // a teacher's own Zoom room, used for her lessons that have no other link
  if (!error && formData.has('zoom_url')) {
    const zoom = String(formData.get('zoom_url') ?? '').trim() || null;
    ({ error } = await supabase.from('teacher_settings').upsert({ teacher_id: user.id, zoom_url: zoom }, { onConflict: 'teacher_id' }));
  }
  revalidatePath('/', 'layout');
  redirect(error ? `/settings?e=${encodeURIComponent(error.message)}` : '/settings?ok=1');
}

// The EN / UA switch in the top bar.
export async function setLocale(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const locale = formData.get('locale') === 'uk' ? 'uk' : 'en';
  await supabase.from('profiles').update({ locale }).eq('id', user.id);
  revalidatePath('/', 'layout');
  const back = (await headers()).get('referer');
  let path = '/';
  try { if (back) { const u = new URL(back); path = u.pathname + u.search; } } catch { path = '/'; }
  redirect(path);
}
