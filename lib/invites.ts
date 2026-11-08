import type { SupabaseClient } from '@supabase/supabase-js';

export type PendingTeacher = { email: string; full_name: string };

// Teachers who were invited and have not signed in yet. Groups and students
// can already be given to them (the form value is "invite:<email>"); they
// move to the teacher on her first sign-in. Only the owner can read invites,
// so for everyone else the list is empty.
export async function pendingTeachers(supabase: SupabaseClient): Promise<PendingTeacher[]> {
  const { data } = await supabase.from('invites').select('email, full_name')
    .is('accepted_at', null).in('role', ['teacher', 'head_teacher']).order('full_name');
  return (data ?? []) as PendingTeacher[];
}

export const INVITE = 'invite:';

// "invite:a@b.c" -> { invite: 'a@b.c' }, "<uuid>" -> { teacher: '<uuid>' }, "" -> {}
export function parseTeacherChoice(value: string): { teacher?: string; invite?: string } {
  if (!value) return {};
  return value.startsWith(INVITE) ? { invite: value.slice(INVITE.length) } : { teacher: value };
}
