import StudentShell from '@/components/StudentShell';
import StudentMaterials from '@/components/StudentMaterials';
import { requireProfile } from '@/lib/session';
import { loadPreview } from '@/lib/studentPreview';

export default async function StudentPreviewMaterials({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const p = await loadPreview(supabase, profile, t, id);
  return (
    <StudentShell t={t} locale={profile.locale} name={p.name} active="/me/materials" preview={p.frame}>
      <StudentMaterials supabase={supabase} studentIds={[id]} groupList={p.groups} t={t} locale={profile.locale} fileBase="/library" />
    </StudentShell>
  );
}
