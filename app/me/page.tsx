import Link from 'next/link';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import { requireProfile } from '@/lib/session';

// A student's home: straight to their course when they have one group.
export default async function MyCourses() {
  const { supabase, profile, t } = await requireProfile(['student']);
  const { data: raw } = await supabase.rpc('my_course_groups');
  const data = (raw ?? []) as { id: string; name: string; program_title: string | null }[];
  if (data?.length === 1) redirect(`/me/groups/${data[0].id}`);
  return (
    <Shell profile={profile} t={t} active="/me">
      <h1>{t('navCourse')}</h1>
      {!data?.length && <p className="muted">{t('c_noCourses')}</p>}
      <div className="grid">
        {(data ?? []).map((g) => (
          <Link key={g.id} href={`/me/groups/${g.id}`} className="card stat">
            <span style={{ fontSize: 19, fontWeight: 700 }}>{g.program_title ?? g.name}</span>
            <small>{g.name}</small>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
