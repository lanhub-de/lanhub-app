'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { kyivLocalToIso } from '@/lib/i18n';

const STATUSES = ['scheduled', 'done', 'no_show', 'late_cancel', 'cancelled', 'force_majeure', 'rescheduled'];

function back(path: string, error?: string) {
  revalidatePath(path.split('?')[0]);
  redirect(error ? `${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}` : path);
}

export async function setLessonStatus(formData: FormData) {
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  if (!STATUSES.includes(status)) back(returnTo, 'Unknown status');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update({ status }).eq('id', id);
  back(returnTo, error?.message);
}

// A lesson moved to another time (Kyiv time in the form).
export async function moveLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const local = String(formData.get('starts_at') || '');
  if (!local) back(returnTo, 'Choose the new time');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update({ starts_at: kyivLocalToIso(local) }).eq('id', id);
  back(returnTo, error?.message);
}

export async function addLesson(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const returnTo = String(formData.get('return_to') || '/teacher');
  const who = String(formData.get('who') || '');
  const startsLocal = String(formData.get('starts_at') || '');
  if (!who || !startsLocal) back(returnTo, 'Fill in who and when');
  const [type, id] = who.split(':');
  const teacherId = String(formData.get('teacher_id') || user.id);
  const row: Record<string, unknown> = {
    teacher_id: teacherId,
    starts_at: kyivLocalToIso(startsLocal),
    duration_min: Number(formData.get('duration_min') || 60),
    zoom_url: String(formData.get('zoom_url') || '') || null,
  };
  if (type === 'g') row.group_id = id; else row.student_id = id;
  const kind = String(formData.get('kind') || '');
  if (kind) row.kind = kind;
  const { error } = await supabase.from('lessons').insert(row);
  back(returnTo, error?.message);
}
