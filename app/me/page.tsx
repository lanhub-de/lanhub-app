import Link from 'next/link';
import { redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import HomeworkForm from '@/components/HomeworkForm';
import HomeworkView from '@/components/HomeworkView';
import LocalTime from '@/components/LocalTime';
import { requireProfile } from '@/lib/session';
import { fmtDate } from '@/lib/i18n';
import { HOMEWORK_COLUMNS, homeworkLabels, withFileLinks, type Homework } from '@/lib/homework';

type MyLesson = {
  id: string; starts_at: string; duration_min: number; status: string; zoom_url: string | null;
  recording_url: string | null; homework_url: string | null; teacher_id: string; teacher_name: string | null; student_id: string;
};

const HELD = ['done', 'no_show', 'late_cancel'];

// A student's home: her group courses, and her individual lessons with Zoom,
// what is left in her package and her homework. With just one group and no
// individual lessons she goes straight to the course.
export default async function MyHome() {
  const { supabase, profile, t } = await requireProfile(['student']);
  const now = Date.now();
  const from = new Date(now - 30 * 864e5).toISOString();
  const to = new Date(now + 45 * 864e5).toISOString();
  const [groupsRes, lessonsRes, idsRes] = await Promise.all([
    supabase.rpc('my_course_groups'),
    supabase.rpc('my_lessons', { p_from: from, p_to: to }),
    supabase.rpc('my_student_ids'),
  ]);
  const groups = (groupsRes.data ?? []) as { id: string; name: string; program_title: string | null }[];
  const lessons = (lessonsRes.data ?? []) as MyLesson[];
  if (groups.length === 1 && lessons.length === 0) redirect(`/me/groups/${groups[0].id}`);

  const myIds = (idsRes.data ?? []) as string[];
  const [pkgs, hwRes] = await Promise.all([
    myIds.length
      ? supabase.from('package_usage').select('student_id, lessons_total, lessons_used, lessons_left, valid_until, status').in('student_id', myIds).eq('status', 'active')
      : Promise.resolve({ data: [] }),
    lessons.length
      ? supabase.from('homework').select(HOMEWORK_COLUMNS).in('lesson_id', lessons.map((l) => l.id))
      : Promise.resolve({ data: [] }),
  ]);
  const homework = await withFileLinks(supabase, (hwRes.data ?? []) as Homework[]);
  const hwBy = new Map(homework.map((h) => [h.lesson_id, h]));
  const upcoming = lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at).getTime() > now - 2 * 3600e3);
  const held = lessons.filter((l) => HELD.includes(l.status)).reverse();
  const next = upcoming[0];
  const pkg = (pkgs.data ?? [])[0] as { lessons_total: number; lessons_used: number; lessons_left: number; valid_until: string | null } | undefined;

  return (
    <Shell profile={profile} t={t} active="/me">
      <h1>{t('meTitle', { name: profile.full_name.split(' ')[0] })}</h1>

      <div className="cabinet">
        <section className="stack cabinet-main">
          {next && (
            <section className="next-card" aria-label={t('c_next')}>
              <span className="next-when">{t('c_next')} · <LocalTime iso={next.starts_at} locale={profile.locale} /></span>
              <strong className="next-title">{next.teacher_name ? t('c_with', { teacher: next.teacher_name }) : ''}</strong>
              {next.zoom_url && <a className="next-zoom" href={next.zoom_url} target="_blank" rel="noreferrer">{t('c_join')}</a>}
            </section>
          )}

          {groups.length > 0 && (
            <div className="grid">
              {groups.map((g) => (
                <Link key={g.id} href={`/me/groups/${g.id}`} className="card stat">
                  <span className="eyebrow">{t('chatKindGroup')}</span>
                  <span style={{ fontSize: 19, fontWeight: 700 }}>{g.program_title ?? g.name}</span>
                  <small>{g.name}</small>
                </Link>
              ))}
            </div>
          )}

          {lessons.length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('meUpcoming')}</h2>
              {upcoming.length === 0 && <p className="muted">{t('meNoUpcoming')}</p>}
              {upcoming.map((l) => (
                <div key={l.id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)' }}>
                  <span><strong><LocalTime iso={l.starts_at} locale={profile.locale} /></strong>{l.teacher_name ? <span className="muted"> · {l.teacher_name}</span> : null}</span>
                  {l.zoom_url && <a href={l.zoom_url} target="_blank" rel="noreferrer">Zoom</a>}
                </div>
              ))}
            </div>
          )}

          {held.length > 0 && (
            <div className="stack">
              <h2 style={{ margin: '6px 0 0' }}>{t('meHomework')}</h2>
              {held.map((l) => {
                const h = hwBy.get(l.id);
                return (
                  <article key={l.id} className="card stack" style={{ gap: 8 }}>
                    <div className="spread">
                      <strong><LocalTime iso={l.starts_at} locale={profile.locale} /></strong>
                      <span className="row">
                        {l.recording_url && <a href={l.recording_url} target="_blank" rel="noreferrer">{t('c_watch')}</a>}
                        {l.homework_url && <a href={l.homework_url} target="_blank" rel="noreferrer">{t('c_homework')}</a>}
                        {h && <span className={`pill ${h.status === 'checked' ? 'ok' : ''}`}>{h.status === 'checked' ? t('hwChecked') : t('hwSentOn', { date: fmtDate(h.submitted_at, profile.locale) })}</span>}
                      </span>
                    </div>
                    {h && <HomeworkView body={h.body} url={h.file_url} kind={h.file_kind} name={h.file_name} />}
                    {h?.status === 'checked' && (h.feedback || h.feedback_url) && (
                      <div className="hw-feedback">
                        <strong>{t('hwTeacherSays')}</strong>
                        <HomeworkView body={h.feedback} url={h.feedback_url} kind={h.feedback_file_kind} name={h.feedback_file_name} />
                      </div>
                    )}
                    {h ? (
                      <details>
                        <summary>{t('hwAgain')}</summary>
                        <HomeworkForm mode="submit" lessonId={l.id} studentId={l.student_id} labels={homeworkLabels(t, 'submit')} path="/me" />
                      </details>
                    ) : (
                      <HomeworkForm mode="submit" lessonId={l.id} studentId={l.student_id} labels={homeworkLabels(t, 'submit')} path="/me" />
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {!groups.length && !lessons.length && <p className="muted">{t('c_noCourses')}</p>}
        </section>

        <aside className="stack cabinet-side">
          {pkg && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('mePackage')}</h2>
              <div className="big" style={{ color: 'var(--red)' }}>{t('lessonsLeft', { n: pkg.lessons_left })}</div>
              <div className="muted">{t('mePackageUsed', { n: pkg.lessons_used, m: pkg.lessons_total })}</div>
              {pkg.valid_until && <div className="muted">{t('validUntil', { date: fmtDate(pkg.valid_until, profile.locale) })}</div>}
            </div>
          )}
          <Link href="/chat" className="card hw-tile">
            <span><strong>{t('navChat')}</strong><span className="muted" style={{ display: 'block', fontSize: 13 }}>{t('meChatHint')}</span></span>
            <span aria-hidden="true" style={{ fontSize: 26 }}>💬</span>
          </Link>
        </aside>
      </div>
    </Shell>
  );
}
