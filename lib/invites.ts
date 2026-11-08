import type { SupabaseClient } from '@supabase/supabase-js';

export type PendingTeacher = { email: string; full_name: string };

// Teachers who were invited and have not signed in yet. Groups and students
// can already be given to them (the form value is "invite:<email>"); they
// move to the teacher on her first sign-in. The owner and the head teacher
// get the list; for everyone else it is empty.
export async function pendingTeachers(supabase: SupabaseClient): Promise<PendingTeacher[]> {
  const { data } = await supabase.rpc('pending_teacher_list');
  return (data ?? []) as PendingTeacher[];
}

export const INVITE = 'invite:';

// "invite:a@b.c" -> { invite: 'a@b.c' }, "<uuid>" -> { teacher: '<uuid>' }, "" -> {}
export function parseTeacherChoice(value: string): { teacher?: string; invite?: string } {
  if (!value) return {};
  return value.startsWith(INVITE) ? { invite: value.slice(INVITE.length) } : { teacher: value };
}
