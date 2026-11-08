'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { kyivLocalToIso } from '@/lib/i18n';

const STATUSES = ['scheduled', 'done', 'no_show', 'late_cancel', 'cancelled', 'force_majeure', 'rescheduled'];

// After a change the page refreshes in place (no jump to the top); only an
// error goes back with a message in the address.
function back(path: string, error?: string) {
  revalidatePath(path.split('?')[0]);
  if (error) redirect(`${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}`);
}

export async function setLessonStatus(formData: FormData) {
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  if (!STATUSES.includes(status)) return back(returnTo, 'Unknown status');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update({ status }).eq('id', id);
  back(returnTo, error?.message);
}

// A lesson moved to another time (Kyiv time in the form).
export async function moveLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const local = String(formData.get('starts_at') || '');
  if (!local) return back(returnTo, 'Choose the new time');
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
  if (!who || !startsLocal) return back(returnTo, 'Fill in who and when');
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

// Materials for one lesson: a library file or the teacher's own.
export async function attachLessonFile(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/teacher');
  const fileId = String(formData.get('file_id') || '');
  if (!fileId) return back(returnTo, 'Choose a file');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lesson_files')
    .upsert({ lesson_id: String(formData.get('lesson_id')), file_id: fileId }, { ignoreDuplicates: true });
  back(returnTo, error?.message);
}

export async function detachLessonFile(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lesson_files').delete()
    .eq('lesson_id', String(formData.get('lesson_id'))).eq('file_id', String(formData.get('file_id')));
  back(returnTo, error?.message);
}

// The lesson's topic (note) and its homework task, from the lesson card.
export async function saveLessonPlan(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const note = String(formData.get('note') ?? '').trim() || null;
  const homework = String(formData.get('homework_text') ?? '').trim() || null;
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update({ note, homework_text: homework }).eq('id', id);
  back(returnTo, error?.message);
}

// The student's working links, schedule and the teacher's notes about her.
export async function saveStudentInfo(formData: FormData) {
  const sid = String(formData.get('student_id'));
  const returnTo = String(formData.get('return_to') || `/teacher/students/${sid}`);
  const v = (k: string) => String(formData.get(k) ?? '');
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('save_student_info', {
    sid, p_zoom: v('zoom_url'), p_goodnotes: v('goodnotes_url'), p_quizlet: v('quizlet_url'),
    p_schedule: v('schedule_note'), p_notes: v('notes'),
  });
  back(returnTo, error?.message);
}
