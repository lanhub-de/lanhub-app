import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import HomeworkForm from '@/components/HomeworkForm';
import HomeworkView from '@/components/HomeworkView';
import LocalTime from '@/components/LocalTime';
import type { Locale, T } from '@/lib/i18n';
import { fmtDate } from '@/lib/i18n';
import { HOMEWORK_COLUMNS, homeworkLabels, withFileLinks, type Homework } from '@/lib/homework';
import { openChat } from '@/app/chat/actions';

type Lesson = {
  id: string; starts_at: string; duration_min: number; status: string; zoom_url: string | null;
  recording_url: string | null; homework_url: string | null; note: string | null; homework_text: string | null;
  teacher_id: string; teacher_name: string | null; student_id: string;
};
type Msg = { id: string; sender_id: string; body: string | null; file_kind: string | null; created_at: string };

const HELD = ['done', 'no_show', 'late_cancel'];

// The individual student's home, as in the mockup: next lesson with Zoom,
// what to open before it, homework, her lessons, package, links and the chat
// with her teacher. The school and her teacher see the same page (preview),
// without the hand-in form.
export default async function StudentHome({
  supabase, studentId, t, locale, preview, groups = [],
}: {
  supabase: SupabaseClient; studentId: string; t: T; locale: Locale; preview?: boolean;
  groups?: { id: string; name: string; program_title: string | null }[];
}) {
  const now = Date.now();
  const from = new Date(now - 60 * 864e5).toISOString();
  const to = new Date(now + 45 * 864e5).toISOString();
  const [studentRes, teacherRes, lessonsRes, pkgRes, chatRes] = await Promise.all([
    supabase.from('students').select('id, full_name, level, goodnotes_url, quizlet_url, schedule_note').eq('id', studentId).maybeSingle(),
    supabase.rpc('student_teacher', { sid: studentId }),
    supabase.rpc('student_lessons', { sid: studentId, p_from: from, p_to: to }),
    supabase.from('package_usage').select('lessons_total, lessons_used, lessons_left, valid_until').eq('student_id', studentId).eq('status', 'active').maybeSingle(),
    supabase.from('conversations').select('id').eq('kind', 'direct').eq('student_id', studentId).limit(1).maybeSingle(),
  ]);
  const s = studentRes.data;
  if (!s) return <p className="muted">{t('nothingHere')}</p>;
  const teacher = ((teacherRes.data ?? []) as { teacher_id: string | null; teacher_name: string | null; can_chat: boolean }[])[0];
  const lessons = (lessonsRes.data ?? []) as Lesson[];
  const ids = lessons.map((l) => l.id);
  const [hwRes, filesRes, msgsRes] = await Promise.all([
    ids.length ? supabase.from('homework').select(HOMEWORK_COLUMNS).in('lesson_id', ids) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from('lesson_files').select('lesson_id, files(id, title)').in('lesson_id', ids)
        .returns<{ lesson_id: string; files: { id: string; title: string } | null }[]>()
      : Promise.resolve({ data: [] as { lesson_id: string; files: { id: string; title: string } | null }[] }),
    chatRes.data
      ? supabase.from('messages').select('id, sender_id, body, file_kind, created_at').eq('conversation_id', chatRes.data.id)
        .order('created_at', { ascending: false }).limit(3)
      : Promise.resolve({ data: [] as Msg[] }),
  ]);
  const homework = await withFileLinks(supabase, (hwRes.data ?? []) as Homework[]);
  const hwBy = new Map(homework.map((h) => [h.lesson_id, h]));
  const filesOf = (lid: string) => (filesRes.data ?? []).filter((f) => f.lesson_id === lid && f.files).map((f) => f.files!);
  const allFiles = [...new Map((filesRes.data ?? []).filter((f) => f.files).map((f) => [f.files!.id, f.files!])).values()];

  const upcoming = lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at).getTime() > now - 2 * 3600e3);
  const past = lessons.filter((l) => !upcoming.includes(l)).reverse();
  const held = past.filter((l) => HELD.includes(l.status));
  const next = upcoming[0];
  const lastHeld = held[0];
  const checkedBefore = held.slice(1).filter((l) => hwBy.get(l.id)?.status === 'checked').slice(0, 3);
  const pkg = pkgRes.data as { lessons_total: number; lessons_used: number; lessons_left: number; valid_until: string | null } | null;
  const msgs = ((msgsRes.data ?? []) as Msg[]).reverse();
  const first = s.full_name.split(' ')[0];
  const fileHref = (id: string) => (preview ? `/library/${id}` : `/me/files/${id}`);
  const statusLine = (l: Lesson) => {
    if (l.status === 'no_show') return t('stuNoShow');
    if (l.status === 'late_cancel') return t('stuLate');
    if (l.status === 'cancelled' || l.status === 'rescheduled') return t('stuCancelled');
    return t(`st_${l.status}` as never);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      {preview && <div className="flash">{t('studentPreview', { name: s.full_name })}</div>}
      <div>
        <h1 style={{ marginBottom: 4 }}>{t('meTitle', { name: first })}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {[s.level, teacher?.teacher_name ? t('withTeacher', { name: teacher.teacher_name }) : null, s.schedule_note].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="cabinet">
        <section className="stack cabinet-main">
          {next ? (
            <section className="next-card" aria-label={t('c_next')}>
              <span className="next-when">{t('c_next')} · <LocalTime iso={next.starts_at} locale={locale} /></span>
              <strong className="next-title">
                {[next.teacher_name ? t('c_with', { teacher: next.teacher_name }) : null, s.level, next.note].filter(Boolean).join(' · ')}
              </strong>
              {next.zoom_url
                ? <a className="next-zoom" href={next.zoom_url} target="_blank" rel="noreferrer">{t('c_join')}</a>
                : <span style={{ opacity: .85, fontSize: 14 }}>{t('zoomComing')}</span>}
            </section>
          ) : (
            <div className="card muted">{t('meNoUpcoming')}</div>
          )}

          {next && (filesOf(next.id).length > 0 || s.goodnotes_url || s.quizlet_url) && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('beforeLesson')}</h2>
              {filesOf(next.id).map((f) => (
                <Link key={f.id} href={fileHref(f.id)} className="spread list-row">
                  <span>📄 {f.title}</span><span className="open-link">{t('open')}</span>
                </Link>
              ))}
              {s.goodnotes_url && <a href={s.goodnotes_url} target="_blank" rel="noreferrer" className="spread list-row"><span>✏️ GoodNotes</span><span className="open-link">{t('open')}</span></a>}
              {s.quizlet_url && <a href={s.quizlet_url} target="_blank" rel="noreferrer" className="spread list-row"><span>🗂 Quizlet</span><span className="open-link">{t('open')}</span></a>}
            </div>
          )}

          {lastHeld && (
            <div className="card stack" style={{ gap: 10 }}>
              <div className="spread">
                <h2 style={{ margin: 0 }}>{t('c_homework')}</h2>
                <span className="muted" style={{ fontSize: 13 }}>{t('afterLessonOn', { date: fmtDate(lastHeld.starts_at, locale) })}</span>
              </div>
              {lastHeld.homework_text && <div className="hw-task">{lastHeld.homework_text}</div>}
              {lastHeld.homework_url && <a href={lastHeld.homework_url} target="_blank" rel="noreferrer">{t('c_homework')} ↗</a>}
              {(() => {
                const h = hwBy.get(lastHeld.id);
                return (
                  <>
                    {h && (
                      <div className="stack" style={{ gap: 8 }}>
                        <span className={`pill ${h.status === 'checked' ? 'ok' : ''}`} style={{ alignSelf: 'flex-start' }}>
                          {h.status === 'checked' ? t('hwCheckedBy', { name: teacher?.teacher_name ?? '' }) : t('hwSentTo', { name: teacher?.teacher_name ?? '' })}
                        </span>
                        <HomeworkView body={h.body} url={h.file_url} kind={h.file_kind} name={h.file_name} />
                        {h.status === 'checked' && (h.feedback || h.feedback_url) && (
                          <div className="hw-feedback">
                            <strong>{t('hwTeacherSays')}</strong>
                            <HomeworkView body={h.feedback} url={h.feedback_url} kind={h.feedback_file_kind} name={h.feedback_file_name} />
                          </div>
                        )}
                      </div>
                    )}
                    {preview ? (
                      <p className="muted" style={{ margin: 0 }}>{t('hwPreview')}</p>
                    ) : h ? (
                      <details><summary>{t('hwReplace')}</summary>
                        <HomeworkForm mode="submit" lessonId={lastHeld.id} studentId={studentId} labels={homeworkLabels(t, 'submit')} path="/me" />
                      </details>
                    ) : (
                      <HomeworkForm mode="submit" lessonId={lastHeld.id} studentId={studentId} labels={homeworkLabels(t, 'submit')} path="/me" />
                    )}
                  </>
                );
              })()}
              {checkedBefore.map((l) => {
                const h = hwBy.get(l.id)!;
                return (
                  <details key={l.id} className="hw-older">
                    <summary>{[fmtDate(l.starts_at, locale), l.note].filter(Boolean).join(' · ')} · {t('hwCheckedBy', { name: teacher?.teacher_name ?? '' })}</summary>
                    {(h.feedback || h.feedback_url) && (
                      <div className="hw-feedback" style={{ marginTop: 8 }}>
                        <HomeworkView body={h.feedback} url={h.feedback_url} kind={h.feedback_file_kind} name={h.feedback_file_name} />
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          )}

          {lessons.length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('meUpcoming')}</h2>
              {upcoming.slice(1).map((l) => (
                <div key={l.id} className="lesson-line">
                  <strong><LocalTime iso={l.starts_at} locale={locale} /></strong>
                  <span className="muted">{l.note ?? ''}</span>
                  <span className="pill">{t('planned')}</span>
                </div>
              ))}
              {past.map((l) => (
                <div key={l.id} className="lesson-line">
                  <strong><LocalTime iso={l.starts_at} locale={locale} /></strong>
                  <span className="muted">
                    {l.note ?? ''}
                    {l.recording_url && <span> · <a href={l.recording_url} target="_blank" rel="noreferrer">{t('c_watch')}</a></span>}
                    {filesOf(l.id).map((f) => <span key={f.id}> · <Link href={fileHref(f.id)}>{f.title}</Link></span>)}
                    {hwBy.get(l.id) && <span> · {hwBy.get(l.id)!.status === 'checked' ? '✅' : '📚'}</span>}
                  </span>
                  <span className={`pill ${HELD.includes(l.status) ? 'ok' : ''}`}>{statusLine(l)}</span>
                </div>
              ))}
            </div>
          )}

          {groups.length > 0 && (
            <div className="grid">
              {groups.map((g) => (
                <Link key={g.id} href={preview ? `/groups/${g.id}/preview` : `/me/groups/${g.id}`} className="card stat">
                  <span className="eyebrow">{t('chatKindGroup')}</span>
                  <span style={{ fontSize: 19, fontWeight: 700 }}>{g.program_title ?? g.name}</span>
                  <small>{g.name}</small>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="stack cabinet-side">
          {pkg && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('mePackage')}{s.level ? ` ${s.level}` : ''}</h2>
              <div className="big" style={{ color: 'var(--red)' }}>{t('pkgOf', { n: pkg.lessons_used, m: pkg.lessons_total })}</div>
              <div className="bar" aria-hidden="true" style={{ margin: '8px 0' }}>
                {Array.from({ length: pkg.lessons_total }, (_, i) => <span key={i} className={i < pkg.lessons_used ? 'on' : ''} />)}
              </div>
              {pkg.valid_until && <div className="muted">{t('validUntil', { date: fmtDate(pkg.valid_until, locale) })}</div>}
              {!preview && <Link href="/chat" className="btn small" style={{ marginTop: 10 }}>{t('renewPackage')}</Link>}
            </div>
          )}
          {allFiles.length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('myMaterials')}</h2>
              {allFiles.map((f) => (
                <Link key={f.id} href={fileHref(f.id)} className="spread list-row"><span>📄 {f.title}</span><span className="open-link">{t('open')}</span></Link>
              ))}
            </div>
          )}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{teacher?.teacher_name ? t('chatWith', { name: teacher.teacher_name }) : t('navChat')}</h2>
            {msgs.length === 0 && <p className="muted" style={{ margin: 0 }}>{teacher?.can_chat ? t('chatEmpty') : t('chatAfterSignIn', { name: teacher?.teacher_name ?? '' })}</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`bubble-row ${m.sender_id === teacher?.teacher_id ? '' : 'mine'}`} style={{ marginBottom: 6 }}>
                <div className={`bubble ${m.sender_id === teacher?.teacher_id ? '' : 'mine'}`}>
                  <div className="bubble-text">{m.body ?? (m.file_kind === 'audio' ? '🎤' : '📎')}</div>
                </div>
              </div>
            ))}
            {!preview && (chatRes.data ? (
              <Link href={`/chat?c=${chatRes.data.id}`} className="btn small" style={{ marginTop: 8 }}>{t('openChat')}</Link>
            ) : teacher?.can_chat && teacher.teacher_id ? (
              <form action={openChat} style={{ marginTop: 8 }}>
                <input type="hidden" name="kind" value="direct" />
                <input type="hidden" name="student_id" value={studentId} />
                <input type="hidden" name="teacher_id" value={teacher.teacher_id} />
                <button type="submit" className="small">{t('openChat')}</button>
              </form>
            ) : (
              <Link href="/chat" className="btn small" style={{ marginTop: 8 }}>{t('schoolChat')}</Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
