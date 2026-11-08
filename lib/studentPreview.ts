import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '@/lib/session';
import type { T } from '@/lib/i18n';

// What every "view as student" page needs: her name, her groups, and the
// frame's settings (where the tabs lead and the way back).
export async function loadPreview(supabase: SupabaseClient, profile: Profile, t: T, id: string) {
  const [{ data: st }, { data: rows }] = await Promise.all([
    supabase.from('students').select('full_name').eq('id', id).maybeSingle(),
    supabase.from('group_members').select('groups(id, name)').eq('student_id', id)
      .returns<{ groups: { id: string; name: string } | null }[]>(),
  ]);
  if (!st) redirect('/');
  const groups = (rows ?? []).filter((r) => r.groups).map((r) => ({ id: r.groups!.id, name: r.groups!.name, program_title: null }));
  const back = profile.role === 'teacher' ? `/teacher/students/${id}` : `/school/students/${id}`;
  return {
    name: (st as { full_name: string }).full_name,
    groups,
    frame: { back, label: t('backToStudent'), base: `/students/${id}/preview` },
  };
}
