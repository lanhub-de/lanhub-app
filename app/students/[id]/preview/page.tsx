import StudentShell from '@/components/StudentShell';
import StudentHome from '@/components/StudentHome';
import { requireProfile } from '@/lib/session';
import { loadPreview } from '@/lib/studentPreview';

// The school and the student's teacher see her home exactly as she does,
// in the student's own frame; the tabs work too.
export default async function StudentPreview({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const p = await loadPreview(supabase, profile, t, id);
  return (
    <StudentShell t={t} locale={profile.locale} name={p.name} active="/me" preview={p.frame}>
      <StudentHome supabase={supabase} studentId={id} t={t} locale={profile.locale} preview groups={p.groups} />
    </StudentShell>
  );
}
