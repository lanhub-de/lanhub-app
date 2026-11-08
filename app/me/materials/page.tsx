import Shell from '@/components/Shell';
import StudentMaterials from '@/components/StudentMaterials';
import type { Group } from '@/components/StudentSchedule';
import { requireProfile } from '@/lib/session';

export default async function MyMaterials() {
  const { supabase, profile, t } = await requireProfile(['student']);
  const [{ data: ids }, { data: groups }] = await Promise.all([supabase.rpc('my_student_ids'), supabase.rpc('my_course_groups')]);
  return (
    <Shell profile={profile} t={t} active="/me/materials">
      <StudentMaterials supabase={supabase} studentIds={(ids ?? []) as string[]} groupList={(groups ?? []) as Group[]}
        t={t} locale={profile.locale} fileBase="/me/files" />
    </Shell>
  );
}
