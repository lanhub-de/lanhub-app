import Link from 'next/link';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import StudentHome from '@/components/StudentHome';
import { requireProfile } from '@/lib/session';

// A student's home. With individual lessons: next lesson with Zoom, homework,
// her lessons, package and the chat with her teacher (StudentHome, the same
// page the school opens as "view as student"). With only one group she goes
// straight to the course.
export default async function MyHome() {
  const { supabase, profile, t } = await requireProfile(['student']);
  const now = Date.now();
  const [groupsRes, lessonsRes, idsRes] = await Promise.all([
    supabase.rpc('my_course_groups'),
    supabase.rpc('my_lessons', { p_from: new Date(now - 60 * 864e5).toISOString(), p_to: new Date(now + 45 * 864e5).toISOString() }),
    supabase.rpc('my_student_ids'),
  ]);
  const groups = (groupsRes.data ?? []) as { id: string; name: string; program_title: string | null }[];
  const lessons = (lessonsRes.data ?? []) as { student_id: string }[];
  const ids = (idsRes.data ?? []) as string[];
  if (groups.length === 1 && lessons.length === 0) redirect(`/me/groups/${groups[0].id}`);

  // the student card with individual lessons (or her only card)
  const sid = lessons[lessons.length - 1]?.student_id ?? (groups.length === 0 ? ids[0] : undefined);

  return (
    <Shell profile={profile} t={t} active="/me">
      {sid ? (
        <StudentHome supabase={supabase} studentId={sid} t={t} locale={profile.locale} groups={groups} />
      ) : (
        <>
          <h1>{t('meTitle', { name: profile.full_name.split(' ')[0] })}</h1>
          {groups.length === 0 && <p className="muted">{t('c_noCourses')}</p>}
          <div className="grid">
            {groups.map((g) => (
              <Link key={g.id} href={`/me/groups/${g.id}`} className="card stat">
                <span className="eyebrow">{t('chatKindGroup')}</span>
                <span style={{ fontSize: 19, fontWeight: 700 }}>{g.program_title ?? g.name}</span>
                <small>{g.name}</small>
              </Link>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}
