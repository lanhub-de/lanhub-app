'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { kyivLocalToIso } from '@/lib/i18n';
import { sendMessage } from '@/app/chat/actions';

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

// "Schedule a lesson": one lesson, or the same time every week for a few
// weeks. For an invited teacher who has not signed in yet the school books it
// as hers (pending), and it moves to her on first sign-in. The student hears
// about it in her chat with the teacher.
export async function addLesson(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const returnTo = String(formData.get('return_to') || '/teacher');
  const who = String(formData.get('who') || '');
  const startsLocal = String(formData.get('starts_at') || '');
  if (!who || !startsLocal) return back(returnTo, 'Fill in who and when');
  const [type, id] = who.split(':');
  const pending = String(formData.get('pending') || '') || null;
  const teacherId = pending ? user.id : String(formData.get('teacher_id') || user.id);
  const repeat = Math.min(Math.max(Number(formData.get('repeat') || 1), 1), 12);
  if (Number.isNaN(new Date(kyivLocalToIso(startsLocal)).getTime())) return back(returnTo, 'Check the date and time');
  const kind = String(formData.get('kind') || '');
  const rows = Array.from({ length: repeat }, (_, i) => {
    const row: Record<string, unknown> = {
      teacher_id: teacherId,
      starts_at: kyivLocalToIso(shiftLocal(startsLocal, i * 7)),
      duration_min: Number(formData.get('duration_min') || 60),
      zoom_url: String(formData.get('zoom_url') || '') || null,
    };
    if (pending) row.pending_teacher = pending;
    if (type === 'g') row.group_id = id;
    else { row.student_id = id; row.kind = kind || 'individual'; }
    return row;
  });
  const { error } = await supabase.from('lessons').insert(rows);
  if (error) return back(returnTo, error.message);

  // let the student know in the chat with her teacher (not for an invited
  // teacher yet: there is no chat until she signs in)
  if (type === 's' && !pending) {
    try {
      const { data: cid } = await supabase.rpc('start_chat', { p_kind: 'direct', p_group: null, p_student: id, p_teacher: teacherId });
      if (cid) {
        const when = rows.map((r) => fmtKyiv(String(r.starts_at))).join(', ');
        await sendMessage({ conversationId: cid as string, body: `📅 ${rows.length > 1 ? 'Нові заняття / New lessons' : 'Нове заняття / New lesson'}: ${when}` });
      }
    } catch { /* the lesson is booked either way */ }
  }
  back(returnTo);
}

// "2026-11-13T18:00" plus n days, still as Kyiv wall-clock time
function shiftLocal(local: string, days: number) {
  if (!days) return local;
  const [d, time] = local.split('T');
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.toISOString().slice(0, 10)}T${time}`;
}

function fmtKyiv(iso: string) {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
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
