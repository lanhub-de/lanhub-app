'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { kyivLocalToIso } from '@/lib/i18n';
import { sendMessage } from '@/app/chat/actions';
import { sendStudentInvite } from '@/lib/mail';

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

// A lesson moved to another time (Kyiv time in the form). The database keeps
// the move in the lesson's history (the school sees moves to another day);
// the student gets a note in her chat with the teacher.
export async function moveLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const local = String(formData.get('starts_at') || '');
  if (!local) return back(returnTo, 'Choose the new time');
  const to = kyivLocalToIso(local);
  if (Number.isNaN(new Date(to).getTime())) return back(returnTo, 'Check the date and time');
  const supabase = await supabaseServer();
  const { data: before } = await supabase.from('lessons').select('starts_at, student_id, teacher_id, pending_teacher')
    .eq('id', id).maybeSingle();
  if (!before) return back(returnTo, 'Lesson not found');
  if (new Date(before.starts_at).getTime() === new Date(to).getTime()) return back(returnTo);
  const { error } = await supabase.from('lessons').update({ starts_at: to }).eq('id', id);
  if (error) return back(returnTo, error.message);
  if (before.student_id && !before.pending_teacher) {
    await tellStudent(supabase, before.student_id, before.teacher_id,
      `🔁 Заняття перенесено / Lesson moved: ${fmtKyiv(before.starts_at)} → ${fmtKyiv(to)}`);
  }
  back(returnTo);
}

// A lesson booked by mistake: the teacher may delete her own booking before it
// starts and within a day of booking it (the database checks this).
export async function deleteLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const { data: l } = await supabase.from('lessons').select('starts_at, student_id, teacher_id, pending_teacher')
    .eq('id', id).maybeSingle();
  if (!l) return back(returnTo, 'Lesson not found');
  const { data: gone, error } = await supabase.from('lessons').delete().eq('id', id).select('id');
  if (error) return back(returnTo, error.message);
  if (!gone?.length) return back(returnTo, 'This booking can no longer be deleted here: please ask the school');
  if (l.student_id && !l.pending_teacher) {
    await tellStudent(supabase, l.student_id, l.teacher_id, `❌ Заняття скасовано / Lesson cancelled: ${fmtKyiv(l.starts_at)}`);
  }
  back(returnTo);
}

async function tellStudent(supabase: Awaited<ReturnType<typeof supabaseServer>>, studentId: string, teacherId: string, body: string) {
  try {
    const { data: cid } = await supabase.rpc('start_chat', { p_kind: 'direct', p_group: null, p_student: studentId, p_teacher: teacherId });
    if (cid) await sendMessage({ conversationId: cid as string, body });
  } catch { /* the change is saved either way */ }
}

// "Schedule a lesson": one lesson, or several (regular weekdays, as listed in
// the form). For an invited teacher who has not signed in yet the school books
// it as hers (pending), and it moves to her on first sign-in. The student
// hears about it in her chat with the teacher.
export async function addLesson(formData: FormData) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const returnTo = String(formData.get('return_to') || '/teacher');
  const who = String(formData.get('who') || '');
  // the form lists every lesson as a Kyiv time; older forms send one time and a weekly repeat
  const startsLocal = String(formData.get('starts_at') || '');
  const repeat = Math.min(Math.max(Number(formData.get('repeat') || 1), 1), 12);
  const listed = formData.getAll('slot').map(String).filter(Boolean);
  const slots = [...new Set(listed.length ? listed : startsLocal ? Array.from({ length: repeat }, (_, i) => shiftLocal(startsLocal, i * 7)) : [])].sort();
  if (!who) return back(returnTo, 'Choose who the lesson is with');
  if (!slots.length) return back(returnTo, 'Choose the date and time');
  if (slots.length > 24) return back(returnTo, 'At most 24 lessons at once');
  if (slots.some((x) => Number.isNaN(new Date(kyivLocalToIso(x)).getTime()))) return back(returnTo, 'Check the date and time');
  const [type, id] = who.split(':');
  const pending = String(formData.get('pending') || '') || null;
  const teacherId = pending ? user.id : String(formData.get('teacher_id') || user.id);
  const kind = String(formData.get('kind') || '');
  const rows = slots.map((local) => {
    const row: Record<string, unknown> = {
      teacher_id: teacherId,
      starts_at: kyivLocalToIso(local),
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
  const update: Record<string, string | null> = { note, homework_text: homework };
  if (formData.has('recording_url')) update.recording_url = String(formData.get('recording_url') ?? '').trim() || null;
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update(update).eq('id', id);
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

// Invite a student to LanHub: her email goes on the card (she signs in with
// it) and she gets an invitation email in her language.
async function inviteOne(supabase: Awaited<ReturnType<typeof supabaseServer>>, sid: string, email: string, locale: string) {
  const { data, error } = await supabase.rpc('set_student_email', { sid, p_email: email, p_locale: locale });
  if (error) return error.message;
  const row = ((data ?? []) as { full_name: string; teacher_name: string | null; email: string; locale: string }[])[0];
  if (!row) return 'Student not found';
  const mailError = await sendStudentInvite(row.email, row.full_name, row.teacher_name, row.locale);
  if (mailError) return mailError;
  await supabase.rpc('student_invite_sent', { sid });
  return null;
}

// The real name first (if given), so the invitation and her profile carry it.
async function renameOne(supabase: Awaited<ReturnType<typeof supabaseServer>>, sid: string, first: string, last: string) {
  if (!first.trim() && !last.trim()) return null;
  const { error } = await supabase.rpc('set_student_name', { sid, p_first: first, p_last: last });
  return error?.message ?? null;
}

export async function inviteStudent(formData: FormData) {
  const sid = String(formData.get('student_id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const err = await renameOne(supabase, sid, String(formData.get('first_name') ?? ''), String(formData.get('last_name') ?? ''))
    ?? await inviteOne(supabase, sid, String(formData.get('email') ?? ''), String(formData.get('locale') ?? 'en'));
  back(returnTo, err ?? undefined);
}

// The whole group at once: names are saved for every row that has them, and
// every row with an email gets invited (one already invited only when ticked).
// A card that still carries a nickname needs a first name before the invite.
export async function inviteGroup(formData: FormData) {
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const ids = formData.getAll('student_id').map(String);
  const errors: string[] = [];
  let sent = 0;
  let named = 0;
  for (const sid of ids) {
    const label = String(formData.get(`name_${sid}`) ?? '');
    const first = String(formData.get(`first_${sid}`) ?? '').trim();
    const last = String(formData.get(`last_${sid}`) ?? '').trim();
    const renamed = `${first} ${last}`.trim();
    if (renamed && renamed !== label) {
      const err = await renameOne(supabase, sid, first, last);
      if (err) { errors.push(`${label}: ${err}`); continue; }
      named += 1;
    }
    const email = String(formData.get(`email_${sid}`) ?? '').trim();
    if (!email || (formData.get(`was_${sid}`) && !formData.get(`again_${sid}`))) continue;
    if (formData.get(`nick_${sid}`) && !first) { errors.push(`${label}: ${String(formData.get('need_name') ?? 'first name needed')}`); continue; }
    const err = await inviteOne(supabase, sid, email, String(formData.get(`locale_${sid}`) ?? 'en'));
    if (err) errors.push(`${renamed || label}: ${err}`); else sent += 1;
  }
  revalidatePath(returnTo.split('?')[0]);
  const q = errors.length ? `e=${encodeURIComponent(errors.join('; '))}&` : '';
  redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}${q}sent=${sent}&named=${named}`);
}

// Only the name (no invitation), from the student's card.
export async function renameStudent(formData: FormData) {
  const sid = String(formData.get('student_id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const err = await renameOne(supabase, sid, String(formData.get('first_name') ?? ''), String(formData.get('last_name') ?? ''));
  back(returnTo, err ?? undefined);
}
