'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { GROUP_TZS, localToIso, SCHOOL_TZ } from '@/lib/i18n';
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

// A lesson moved to another time and/or given another length. The form says
// which clock its time is on: Kyiv (individual lessons, the school journal) or
// the group's own time (a group lesson's card). The database keeps the change
// in the lesson's history (the school sees moves to another day and length
// changes); the student, or the group's chat, gets a note. A lesson marked
// "rescheduled" becomes a booked lesson again at its new time.
export async function moveLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const local = String(formData.get('starts_at') || '');
  if (!local) return back(returnTo, 'Choose the new time');
  const supabase = await supabaseServer();
  const { data: before } = await supabase.from('lessons')
    .select('starts_at, duration_min, status, student_id, group_id, teacher_id, pending_teacher, groups!lessons_group_id_fkey(tz)')
    .eq('id', id).maybeSingle<{
      starts_at: string; duration_min: number; status: string; student_id: string | null; group_id: string | null;
      teacher_id: string; pending_teacher: string | null; groups: { tz: string } | null;
    }>();
  if (!before) return back(returnTo, 'Lesson not found');
  const groupTz = before.groups?.tz ?? SCHOOL_TZ;
  const tz = String(formData.get('tz') || '') === groupTz ? groupTz : SCHOOL_TZ;
  const to = localToIso(local, tz);
  if (Number.isNaN(new Date(to).getTime())) return back(returnTo, 'Check the date and time');
  const minutes = Number(formData.get('duration_min') || before.duration_min || 60);
  const length = [30, 45, 60, 75, 90, 105, 120, 150, 180].includes(minutes) ? minutes : before.duration_min;
  const moved = new Date(before.starts_at).getTime() !== new Date(to).getTime();
  const revive = before.status === 'rescheduled';
  if (!moved && length === before.duration_min && !revive) return back(returnTo);
  const patch: Record<string, unknown> = { starts_at: to, duration_min: length };
  if (revive) patch.status = 'scheduled';
  const { error } = await supabase.from('lessons').update(patch).eq('id', id);
  if (error) return back(returnTo, error.message);
  // a note only about lessons still ahead (fixing the journal afterwards is quiet)
  const ahead = Math.max(new Date(before.starts_at).getTime(), new Date(to).getTime()) > Date.now();
  if (ahead && !before.pending_teacher) {
    if (before.group_id) {
      const f = (iso: string) => fmtIn(iso, groupTz);
      await tellGroup(supabase, before.group_id, moved || revive
        ? `🔁 Заняття перенесено / Lesson moved: ${f(before.starts_at)} → ${f(to)} (${length} хв / min · ${tzNote(groupTz)})`
        : `⏱ Заняття ${f(to)} триватиме ${length} хв / The lesson will take ${length} min`);
    } else if (before.student_id) {
      await tellStudent(supabase, before.student_id, before.teacher_id, moved
        ? `🔁 Заняття перенесено / Lesson moved: ${fmtKyiv(before.starts_at)} → ${fmtKyiv(to)} (${length} хв / min)`
        : `⏱ Заняття ${fmtKyiv(to)} триватиме ${length} хв / The lesson will take ${length} min`);
    }
  }
  back(returnTo);
}

// For teachers who agree on each lesson: the same lesson again a week later
// (same length, Zoom), to adjust if needed.
export async function repeatLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const { data: l } = await supabase.from('lessons')
    .select('teacher_id, student_id, group_id, kind, starts_at, duration_min, zoom_url, pending_teacher, package_id, groups!lessons_group_id_fkey(tz)')
    .eq('id', id).maybeSingle<{
      teacher_id: string; student_id: string | null; group_id: string | null; kind: string; starts_at: string; duration_min: number;
      zoom_url: string | null; pending_teacher: string | null; package_id: string | null; groups: { tz: string } | null;
    }>();
  if (!l) return back(returnTo, 'Lesson not found');
  const next = new Date(new Date(l.starts_at).getTime() + 7 * 24 * 3600e3).toISOString();
  const row: Record<string, unknown> = {
    teacher_id: l.teacher_id, starts_at: next, duration_min: l.duration_min, zoom_url: l.zoom_url, kind: l.kind,
  };
  if (l.pending_teacher) row.pending_teacher = l.pending_teacher;
  if (l.group_id) row.group_id = l.group_id; else row.student_id = l.student_id;
  const { error } = await supabase.from('lessons').insert(row);
  if (error) return back(returnTo, error.message);
  if (l.group_id && !l.pending_teacher) {
    const tz = l.groups?.tz ?? SCHOOL_TZ;
    await tellGroup(supabase, l.group_id, `📅 Нове заняття / New lesson: ${fmtIn(next, tz)} (${tzNote(tz)})`);
  } else if (l.student_id && !l.pending_teacher) {
    await tellStudent(supabase, l.student_id, l.teacher_id, `📅 Нове заняття / New lesson: ${fmtKyiv(next)}`);
  }
  back(returnTo);
}

// A lesson booked by mistake: the teacher may delete her own booking before it
// starts and within a day of booking it (the database checks this).
export async function deleteLesson(formData: FormData) {
  const id = String(formData.get('id'));
  const returnTo = String(formData.get('return_to') || '/teacher');
  const supabase = await supabaseServer();
  const { data: l } = await supabase.from('lessons')
    .select('starts_at, student_id, group_id, teacher_id, pending_teacher, groups!lessons_group_id_fkey(tz)')
    .eq('id', id).maybeSingle<{
      starts_at: string; student_id: string | null; group_id: string | null; teacher_id: string; pending_teacher: string | null;
      groups: { tz: string } | null;
    }>();
  if (!l) return back(returnTo, 'Lesson not found');
  const { data: gone, error } = await supabase.from('lessons').delete().eq('id', id).select('id');
  if (error) return back(returnTo, error.message);
  if (!gone?.length) return back(returnTo, 'This booking can no longer be deleted here: please ask the school');
  if (new Date(l.starts_at).getTime() > Date.now() && !l.pending_teacher) {
    if (l.group_id) {
      const tz = l.groups?.tz ?? SCHOOL_TZ;
      await tellGroup(supabase, l.group_id, `❌ Заняття скасовано / Lesson cancelled: ${fmtIn(l.starts_at, tz)} (${tzNote(tz)})`);
    } else if (l.student_id) {
      await tellStudent(supabase, l.student_id, l.teacher_id, `❌ Заняття скасовано / Lesson cancelled: ${fmtKyiv(l.starts_at)}`);
    }
  }
  back(returnTo);
}

// The same note for a group goes to the group's chat (only people who can
// write there; otherwise the change is simply saved).
async function tellGroup(supabase: Awaited<ReturnType<typeof supabaseServer>>, groupId: string, body: string) {
  try {
    const { data: cid } = await supabase.rpc('start_chat', { p_kind: 'group', p_group: groupId, p_student: null, p_teacher: null });
    if (cid) await sendMessage({ conversationId: cid as string, body });
  } catch { /* the change is saved either way */ }
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
  const lengthOf = (slot: string) => {
    const m = Number(slot.split('|')[1] || formData.get('duration_min') || 60);
    return [30, 45, 60, 75, 90, 105, 120, 150, 180].includes(m) ? m : 60;
  };
  const whenOf = (slot: string) => slot.split('|')[0];
  const [type, id] = who.split(':');
  // a group's lessons are typed in the group's own time when the form says so
  let tz = SCHOOL_TZ;
  if (type === 'g') {
    const { data: g } = await supabase.from('groups').select('tz').eq('id', id).maybeSingle();
    if (!g) return back(returnTo, 'Group not found');
    if (String(formData.get('tz') || '') === g.tz && GROUP_TZS.includes(g.tz)) tz = g.tz;
  }
  if (slots.some((x) => Number.isNaN(new Date(localToIso(whenOf(x), tz)).getTime()))) return back(returnTo, 'Check the date and time');
  const pending = String(formData.get('pending') || '') || null;
  const teacherId = pending ? user.id : String(formData.get('teacher_id') || user.id);
  const kind = String(formData.get('kind') || '');
  const rows = slots.map((slot) => {
    const row: Record<string, unknown> = {
      teacher_id: teacherId,
      starts_at: localToIso(whenOf(slot), tz),
      duration_min: lengthOf(slot),
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
  if (type === 'g' && !pending) {
    const first = fmtIn(String(rows[0].starts_at), tz);
    await tellGroup(supabase, id, rows.length > 3
      ? `📅 Нові заняття / New lessons: ${rows.length}, перше / first ${first} (${tzNote(tz)})`
      : `📅 ${rows.length > 1 ? 'Нові заняття / New lessons' : 'Нове заняття / New lesson'}: ${rows.map((r) => fmtIn(String(r.starts_at), tz)).join(', ')} (${tzNote(tz)})`);
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

function fmtIn(iso: string, tz: string) {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}
function fmtKyiv(iso: string) {
  return fmtIn(iso, SCHOOL_TZ);
}
const tzNote = (tz: string) => (tz === 'Europe/Vienna' ? 'час Відня / Vienna time' : tz === SCHOOL_TZ ? 'за Києвом / Kyiv time' : tz);

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
