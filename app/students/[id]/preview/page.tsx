import Link from 'next/link';
import Shell from '@/components/Shell';
import StudentHome from '@/components/StudentHome';
import { requireProfile } from '@/lib/session';

// The school and the student's teacher see her home exactly as she does.
export default async function StudentPreview({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const { data: rows } = await supabase.from('group_members').select('groups(id, name)').eq('student_id', id)
    .returns<{ groups: { id: string; name: string } | null }[]>();
  const groups = (rows ?? []).filter((r) => r.groups).map((r) => ({ id: r.groups!.id, name: r.groups!.name, program_title: null }));
  const back = profile.role === 'teacher' ? `/teacher/students/${id}` : `/school/students/${id}`;
  return (
    <Shell profile={profile} t={t} active={profile.role === 'teacher' ? '/teacher' : '/school/students'}>
      <p style={{ marginTop: 0 }}><Link href={back}>← {t('backToStudent')}</Link></p>
      <StudentHome supabase={supabase} studentId={id} t={t} locale={profile.locale} preview groups={groups} />
    </Shell>
  );
}
