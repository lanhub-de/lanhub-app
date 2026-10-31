'use server';
import { redirect } from 'next/navigation';
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
  const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
  revalidatePath('/', 'layout');
  redirect(error ? `/settings?e=${encodeURIComponent(error.message)}` : '/settings?ok=1');
}
