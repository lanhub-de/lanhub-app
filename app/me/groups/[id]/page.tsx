import Shell from '@/components/Shell';
import CoursePage from '@/components/CoursePage';
import { requireProfile } from '@/lib/session';

export default async function MyCourse({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ l?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['student']);
  const { id } = await params;
  const { l } = await searchParams;
  return (
    <Shell profile={profile} t={t} active="/me">
      <CoursePage supabase={supabase} groupId={id} selected={l ? Number(l) : undefined} t={t} locale={profile.locale}
        basePath={`/me/groups/${id}`} fileBase="/me/files" />
    </Shell>
  );
}
