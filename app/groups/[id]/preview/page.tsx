import Link from 'next/link';
import Shell from '@/components/Shell';
import CoursePage from '@/components/CoursePage';
import { requireProfile } from '@/lib/session';

// The school and the teacher see the course page exactly as students do.
export default async function CoursePreview({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ l?: string; lang?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const { l } = await searchParams;
  return (
    <Shell profile={profile} t={t} active={profile.role === 'teacher' ? '/teacher' : '/school/groups'}>
      <p style={{ marginTop: 0 }}><Link href={`/groups/${id}`}>← {t('openGroup')}</Link></p>
      <CoursePage supabase={supabase} groupId={id} selected={l ? Number(l) : undefined} t={t} locale={profile.locale}
        basePath={`/groups/${id}/preview`} fileBase="/library" preview />
    </Shell>
  );
}
