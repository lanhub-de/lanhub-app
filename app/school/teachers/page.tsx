import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { loadManagerData } from '@/lib/manager';
import TeacherFolders, { type GroupRow } from '@/components/TeacherFolders';

export default async function TeachersPage({ searchParams }: { searchParams: Promise<{ t?: string; e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const [data, groupRows] = await Promise.all([
    loadManagerData(supabase),
    supabase.from('group_overview').select('id, name, teacher_id, tz, members, lessons_total, lessons_done, next_at').eq('active', true).order('name').returns<GroupRow[]>(),
  ]);
  return (
    <Shell profile={profile} t={t} active="/school/teachers">
      <Flash error={sp.e} />
      <TeacherFolders data={data} groups={groupRows.data ?? []} selected={sp.t} t={t} locale={profile.locale} />
    </Shell>
  );
}
