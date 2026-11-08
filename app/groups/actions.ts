'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const optional = (f: FormData, k: string) => str(f, k) || null;

function back(path: string, error?: string | null) {
  revalidatePath(path);
  redirect(error ? `${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}` : path);
}

// ---------------------------------------------------------------- programs
export async function createProgram(f: FormData) {
  const supabase = await supabaseServer();
  const count = Math.min(Math.max(Number(str(f, 'lessons') || 8), 1), 40);
  const { data, error } = await supabase.from('programs')
    .insert({ title: str(f, 'title'), level: optional(f, 'level') }).select('id').single();
  if (error) back('/school/groups', error.message);
  const rows = Array.from({ length: count }, (_, i) => ({ program_id: data!.id, n: i + 1, title: `${i + 1}` }));
  const { error: e2 } = await supabase.from('program_lessons').insert(rows);
  back(`/school/programs/${data!.id}`, e2?.message);
}

export async function updateProgram(f: FormData) {
  const id = str(f, 'id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('programs').update({
    title: str(f, 'title'), level: optional(f, 'level'), next_program_id: optional(f, 'next_program_id'),
  }).eq('id', id);
  back(`/school/programs/${id}`, error?.message);
}

export async function saveProgramLesson(f: FormData) {
  const programId = str(f, 'program_id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('program_lessons').update({
    title: str(f, 'title') || '…',
    topic: optional(f, 'topic'),
    goal: optional(f, 'goal'),
    rule: optional(f, 'rule'),
    prepare: optional(f, 'prepare'),
    after_note: optional(f, 'after_note'),
    connected: optional(f, 'connected'),
    homework_url: optional(f, 'homework_url'),
    vocab_url: optional(f, 'vocab_url'),
    slides_url: optional(f, 'slides_url'),
    teacher_note: optional(f, 'teacher_note'),
  }).eq('id', str(f, 'id'));
  back(`/school/programs/${programId}?open=${str(f, 'id')}`, error?.message);
}

export async function addProgramLesson(f: FormData) {
  const programId = str(f, 'program_id');
  const supabase = await supabaseServer();
  const { data: last } = await supabase.from('program_lessons').select('n').eq('program_id', programId)
    .order('n', { ascending: false }).limit(1).maybeSingle();
  const n = (last?.n ?? 0) + 1;
  const { error } = await supabase.from('program_lessons').insert({ program_id: programId, n, title: `${n}` });
  back(`/school/programs/${programId}`, error?.message);
}

export async function attachFile(f: FormData) {
  const programId = str(f, 'program_id');
  const lessonId = str(f, 'program_lesson_id');
  const supabase = await supabaseServer();
  const forStudents = str(f, 'for_students') !== 'false';
  const { error } = lessonId
    ? await supabase.from('program_lesson_files').insert({ program_lesson_id: lessonId, file_id: str(f, 'file_id'), for_students: forStudents })
    : await supabase.from('program_files').insert({ program_id: programId, file_id: str(f, 'file_id'), for_students: forStudents });
  back(`/school/programs/${programId}${lessonId ? `?open=${lessonId}` : ''}`, error?.message);
}

export async function detachFile(f: FormData) {
  const programId = str(f, 'program_id');
  const lessonId = str(f, 'program_lesson_id');
  const supabase = await supabaseServer();
  const { error } = lessonId
    ? await supabase.from('program_lesson_files').delete().eq('program_lesson_id', lessonId).eq('file_id', str(f, 'file_id'))
    : await supabase.from('program_files').delete().eq('program_id', programId).eq('file_id', str(f, 'file_id'));
  back(`/school/programs/${programId}${lessonId ? `?open=${lessonId}` : ''}`, error?.message);
}

// ------------------------------------------------------------------ groups
export async function createGroup(f: FormData) {
  const supabase = await supabaseServer();
  const days = f.getAll('days').map(Number).filter((d) => d >= 1 && d <= 7);
  if (!days.length) back('/school/groups', 'Choose the days');
  const { data, error } = await supabase.rpc('create_group', {
    p_program: str(f, 'program_id'),
    p_teacher: str(f, 'teacher_id'),
    p_days: days,
    p_time: str(f, 'time'),
    p_start: str(f, 'start'),
    p_capacity: Number(str(f, 'capacity') || 10),
    p_zoom: optional(f, 'zoom_url'),
    p_name: optional(f, 'name'),
  });
  if (error) back('/school/groups', error.message);
  back(`/groups/${data}`);
}

export async function updateGroup(f: FormData) {
  const id = str(f, 'id');
  const supabase = await supabaseServer();
  const teacherId = str(f, 'teacher_id');
  const zoom = optional(f, 'zoom_url');
  const { error } = await supabase.from('groups').update({
    name: str(f, 'name'), teacher_id: teacherId, zoom_url: zoom, capacity: Number(str(f, 'capacity') || 10),
  }).eq('id', id);
  if (error) back(`/groups/${id}`, error.message);
  // upcoming lessons follow the group
  const { error: e2 } = await supabase.from('lessons').update({ teacher_id: teacherId, zoom_url: zoom })
    .eq('group_id', id).eq('status', 'scheduled').gt('starts_at', new Date().toISOString());
  back(`/groups/${id}`, e2?.message);
}

export async function archiveGroup(f: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('groups').update({ active: false }).eq('id', str(f, 'id'));
  back('/school/groups', error?.message);
}

export async function continueGroup(f: FormData) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('continue_group', { gid: str(f, 'id') });
  if (error) back(`/groups/${str(f, 'id')}`, error.message);
  back(`/groups/${data}`);
}

export async function addMember(f: FormData) {
  const groupId = str(f, 'group_id');
  const supabase = await supabaseServer();
  let studentId = str(f, 'student_id');
  if (!studentId) {
    const name = str(f, 'full_name');
    if (!name) back(`/groups/${groupId}`, 'Choose a student or type a name');
    const intl = str(f, 'market') !== 'ua';
    const { data, error } = await supabase.from('students').insert({
      full_name: name, level: optional(f, 'level'), market: intl ? 'intl' : 'ua', locale: 'en',
      contact: optional(f, 'contact'), email: optional(f, 'email'),
    }).select('id').single();
    if (error) back(`/groups/${groupId}`, error.message);
    studentId = data!.id;
  }
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, student_id: studentId });
  back(`/groups/${groupId}`, error?.message);
}

export async function removeMember(f: FormData) {
  const groupId = str(f, 'group_id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('student_id', str(f, 'student_id'));
  back(`/groups/${groupId}`, error?.message);
}

// --------------------------------------------------- during a group lesson
export async function toggleAbsence(f: FormData) {
  const returnTo = str(f, 'return_to') || '/teacher';
  const supabase = await supabaseServer();
  const row = { lesson_id: str(f, 'lesson_id'), student_id: str(f, 'student_id') };
  const { error } = str(f, 'absent') === '1'
    ? await supabase.from('lesson_absences').insert(row)
    : await supabase.from('lesson_absences').delete().eq('lesson_id', row.lesson_id).eq('student_id', row.student_id);
  back(returnTo, error?.message);
}

export async function setRecording(f: FormData) {
  const returnTo = str(f, 'return_to') || '/teacher';
  const supabase = await supabaseServer();
  const { error } = await supabase.from('lessons').update({ recording_url: optional(f, 'recording_url') }).eq('id', str(f, 'lesson_id'));
  back(returnTo, error?.message);
}
