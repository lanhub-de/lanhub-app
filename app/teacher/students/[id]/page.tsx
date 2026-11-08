import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import HomeworkView from '@/components/HomeworkView';
import { requireProfile, TEACHING } from '@/lib/session';
import { fmtDate, fmtDateTime } from '@/lib/i18n';
import { HOMEWORK_COLUMNS, withFileLinks, type Homework } from '@/lib/homework';
import { asParam, whoseCabinet } from '@/lib/cabinet';
import { openChat } from '@/app/chat/actions';

type L = { id: string; starts_at: string; status: string; recording_url: string | null; homework_url: string | null };

// A student's folder for the teacher: everything from their lessons in one
// place: materials, the lessons with recordings, homework and the package.
export default async function StudentFolder({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const { id } = await params;
  const sp = await searchParams;
  const who = await whoseCabinet(supabase, profile, sp.as);
  const q = asParam(who);

  const { data: s } = await supabase.from('students').select('id, full_name, level, market').eq('id', id).maybeSingle();
  if (!s) notFound();
  const from = new Date(Date.now() - 120 * 864e5).toISOString();
  const lessonsQ = supabase.from('lessons').select('id, starts_at, status, recording_url, homework_url')
    .eq('student_id', id).gte('starts_at', from).order('starts_at', { ascending: false }).limit(60);
  const [lessonsRes, pkg] = await Promise.all([
    who.pending ? lessonsQ.eq('pending_teacher', who.pending) : lessonsQ.eq('teacher_id', who.id),
    supabase.from('package_usage').select('lessons_total, lessons_used, lessons_left, valid_until, status').eq('student_id', id).eq('status', 'active').maybeSingle(),
  ]);
  const lessons = (lessonsRes.data ?? []) as L[];
  const ids = lessons.map((l) => l.id);
  const [files, hwRes] = await Promise.all([
    ids.length
      ? supabase.from('lesson_files').select('lesson_id, files(id, title, level)').in('lesson_id', ids)
        .returns<{ lesson_id: string; files: { id: string; title: string; level: string | null } | null }[]>()
      : Promise.resolve({ data: [] as { lesson_id: string; files: { id: string; title: string; level: string | null } | null }[] }),
    ids.length ? supabase.from('homework').select(HOMEWORK_COLUMNS).in('lesson_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const homework = await withFileLinks(supabase, (hwRes.data ?? []) as Homework[]);
  const hwBy = new Map(homework.map((h) => [h.lesson_id, h]));
  const lessonOf = new Map(lessons.map((l) => [l.id, l]));
  const materials = new Map<string, { id: string; title: string; level: string | null; on: string }>();
  for (const f of files.data ?? []) {
    if (f.files && !materials.has(f.files.id)) materials.set(f.files.id, { ...f.files, on: lessonOf.get(f.lesson_id)?.starts_at ?? '' });
  }
  const p = pkg.data as { lessons_total: number; lessons_used: number; lessons_left: number; valid_until: string | null } | null;

  return (
    <Shell profile={profile} t={t} active="/teacher">
      <p style={{ marginTop: 0 }}><Link href={`/teacher${q ? `?${q}` : ''}`}>← {t('todayHeading')}</Link></p>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('folderTitle', { name: s.full_name })}</h1>
          <p className="muted" style={{ marginTop: 0 }}>{[s.level, s.market === 'intl' ? t('market_intl') : t('market_ua')].filter(Boolean).join(' · ')}</p>
        </div>
        {!who.pending && (
          <form action={openChat}>
            <input type="hidden" name="kind" value="direct" />
            <input type="hidden" name="student_id" value={s.id} />
            <input type="hidden" name="teacher_id" value={who.id} />
            <button className="primary" type="submit">💬 {t('write')}</button>
          </form>
        )}
      </div>

      <div className="cabinet">
        <section className="stack cabinet-main">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('folderMaterials')}</h2>
            {materials.size === 0 && <p className="muted" style={{ margin: 0 }}>{t('folderNoMaterials')}</p>}
            <div className="materials">
              {[...materials.values()].map((f) => (
                <span key={f.id} className="file-chip" style={{ paddingRight: 10 }}>
                  <Link href={`/library/${f.id}`}>📄 {f.title}</Link>
                  {f.on && <span className="muted" style={{ fontSize: 12 }}>· {fmtDate(f.on, profile.locale)}</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('folderLessons')}</h2>
            {lessons.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('nothingHere')}</p>}
            {lessons.map((l) => {
              const h = hwBy.get(l.id);
              return (
                <div key={l.id} className="folder-row">
                  <div className="spread">
                    <strong>{fmtDateTime(l.starts_at, profile.locale)}</strong>
                    <span className="row">
                      {l.recording_url && <a href={l.recording_url} target="_blank" rel="noreferrer">{t('c_watch')}</a>}
                      {l.status !== 'scheduled' && (
                        <span className={`pill ${['done', 'no_show', 'late_cancel'].includes(l.status) ? 'ok' : ''}`}>{t(`st_${l.status}` as never)}</span>
                      )}
                      {h && <span className={`pill ${h.status === 'checked' ? 'ok' : 'warn'}`}>{h.status === 'checked' ? t('hwChecked') : t('hwToCheck')}</span>}
                    </span>
                  </div>
                  {h && (
                    <details>
                      <summary>{t('folderHomework')}</summary>
                      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                        <HomeworkView body={h.body} url={h.file_url} kind={h.file_kind} name={h.file_name} />
                        {h.status === 'checked'
                          ? (h.feedback || h.feedback_url) && (
                            <div className="hw-feedback">
                              <strong>{t('hwTeacherSays')}</strong>
                              <HomeworkView body={h.feedback} url={h.feedback_url} kind={h.feedback_file_kind} name={h.feedback_file_name} />
                            </div>
                          )
                          : <Link href={`/teacher/homework${q ? `?${q}` : ''}`} className="btn small" style={{ alignSelf: 'flex-start' }}>{t('hwOpen')}</Link>}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="stack cabinet-side">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('mePackage')}</h2>
            {p ? (
              <>
                <div className="big" style={{ color: 'var(--red)' }}>{t('lessonsLeft', { n: p.lessons_left })}</div>
                <div className="muted">{t('mePackageUsed', { n: p.lessons_used, m: p.lessons_total })}</div>
                {p.valid_until && <div className="muted">{t('validUntil', { date: fmtDate(p.valid_until, profile.locale) })}</div>}
              </>
            ) : <p className="muted" style={{ margin: 0 }}>{t('noPackage')}</p>}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
