import StudentShell from '@/components/StudentShell';
import CoursePage from '@/components/CoursePage';
import { requireProfile } from '@/lib/session';

// The school and the teacher see the course page exactly as students do,
// in the student's own frame.
export default async function CoursePreview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ l?: string; lang?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const { l } = await searchParams;
  return (
    <StudentShell t={t} locale={profile.locale} name={t('c_studentName')} active="/me"
      preview={{ back: `/groups/${id}`, label: t('openGroup'), text: t('c_preview') }}>
      <CoursePage supabase={supabase} groupId={id} selected={l ? Number(l) : undefined} t={t} locale={profile.locale}
        basePath={`/groups/${id}/preview`} fileBase="/library" preview />
    </StudentShell>
  );
}
