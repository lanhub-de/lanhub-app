import StudentShell from '@/components/StudentShell';
import StudentSchedule from '@/components/StudentSchedule';
import { requireProfile } from '@/lib/session';
import { loadPreview } from '@/lib/studentPreview';

export default async function StudentPreviewSchedule({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const p = await loadPreview(supabase, profile, t, id);
  return (
    <StudentShell t={t} locale={profile.locale} name={p.name} active="/me/schedule" preview={p.frame}>
      <StudentSchedule supabase={supabase} studentIds={[id]} groupList={p.groups} t={t} locale={profile.locale} />
    </StudentShell>
  );
}
