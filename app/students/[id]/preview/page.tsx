import { redirect } from 'next/navigation';
import StudentShell from '@/components/StudentShell';
import StudentHome from '@/components/StudentHome';
import { requireProfile } from '@/lib/session';

// The school and the student's teacher see her home exactly as she does,
// in the student's own frame.
export default async function StudentPreview({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const [{ data: st }, { data: rows }] = await Promise.all([
    supabase.from('students').select('full_name').eq('id', id).maybeSingle(),
    supabase.from('group_members').select('groups(id, name)').eq('student_id', id)
      .returns<{ groups: { id: string; name: string } | null }[]>(),
  ]);
  if (!st) redirect('/');
  const groups = (rows ?? []).filter((r) => r.groups).map((r) => ({ id: r.groups!.id, name: r.groups!.name, program_title: null }));
  const back = profile.role === 'teacher' ? `/teacher/students/${id}` : `/school/students/${id}`;
  return (
    <StudentShell t={t} locale={profile.locale} name={st.full_name} active="/me" preview={{ back, label: t('backToStudent') }}>
      <StudentHome supabase={supabase} studentId={id} t={t} locale={profile.locale} preview groups={groups} />
    </StudentShell>
  );
}
