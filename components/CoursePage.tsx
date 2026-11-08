import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import RichText from '@/components/RichText';
import { IconVideo } from '@/components/Icons';
import { withName } from '@/lib/names';
import type { Locale, T } from '@/lib/i18n';
import { fmtDate, fmtDayInTz, fmtInTz } from '@/lib/i18n';
import HomeworkForm from '@/components/HomeworkForm';
import HomeworkView from '@/components/HomeworkView';
import { HOMEWORK_COLUMNS, homeworkLabels, withFileLinks, type Homework } from '@/lib/homework';

type Head = {
  id: string; name: string; level: string | null; days: number[] | null; start_time: string | null; tz: string;
  zoom_url: string | null; program_id: string | null; program_title: string | null; program_level: string | null;
  teacher_name: string | null;
};
type Slot = {
  id: string; starts_at: string; duration_min: number; status: string; zoom_url: string | null;
  recording_url: string | null; homework_url: string | null; program_lesson_id: string | null;
};
type PL = {
  id: string; n: number; title: string; topic: string | null; goal: string | null; rule: string | null;
  prepare: string | null; after_note: string | null; connected: string | null; homework_url: string | null;
  vocab_url: string | null; slides_url: string | null;
};
type CourseFile = { file_id: string; title: string; program_lesson_id: string | null };

const HELD = ['done', 'no_show', 'late_cancel'];

// The group's course page, as its students see it: the replacement for the
// Notion course hub. Everything comes through the course_* database functions,
// which leave out teacher notes, pay and other students.
export default async function CoursePage({
  supabase, groupId, selected, t, locale, basePath, fileBase, preview,
}: {
  supabase: SupabaseClient; groupId: string; selected?: number; t: T; locale: Locale;
  basePath: string; fileBase: string; preview?: boolean;
}) {
  const [head, schedule, lessons, files, convo] = await Promise.all([
    supabase.rpc('course_group', { gid: groupId }),
    supabase.rpc('course_schedule', { gid: groupId }),
    supabase.rpc('course_lessons', { gid: groupId }),
    supabase.rpc('course_files', { gid: groupId }),
    supabase.from('conversations').select('id').eq('kind', 'group').eq('group_id', groupId).maybeSingle(),
  ]);
  // the last messages of the group chat, as a peek on the course page
  const cid = (convo.data as { id: string } | null)?.id ?? null;
  const [peekRes, peopleRes] = cid
    ? await Promise.all([
      supabase.from('messages').select('id, sender_id, body, file_kind, created_at').eq('conversation_id', cid)
        .order('created_at', { ascending: false }).limit(3),
      supabase.rpc('chat_people', { cid }),
    ])
    : [{ data: [] }, { data: [] }];
  const peek = ((peekRes.data ?? []) as { id: string; sender_id: string; body: string | null; file_kind: string | null }[]).reverse();
  const nameOf = new Map(((peopleRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name.split(' ')[0]]));
  const g = ((head.data ?? []) as Head[])[0];
  if (!g) return <p className="muted">{t('nothingHere')}</p>;
  const scheduleRows = (schedule.data ?? []) as Slot[];
  const lessonRows = (lessons.data ?? []) as PL[];
  const fileRows = (files.data ?? []) as CourseFile[];

  // the student's own hand-ins for this course
  const { data: myIds } = preview ? { data: [] } : await supabase.rpc('my_student_ids');
  const meStudent = ((myIds ?? []) as string[])[0] ?? null;
  const hwRows = meStudent && scheduleRows.length
    ? await withFileLinks(supabase, ((await supabase.from('homework').select(HOMEWORK_COLUMNS)
        .in('lesson_id', scheduleRows.map((r) => r.id))).data ?? []) as Homework[])
    : [];
  const hwBy = new Map(hwRows.map((h) => [h.lesson_id, h]));

  const now = Date.now();
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: g.tz, dateStyle: 'short' }).format(d);
  const today = dayKey(new Date());
  const slotByLesson = new Map(scheduleRows.map((s) => [s.program_lesson_id, s]));
  const items = lessonRows.map((pl) => {
    const slot = slotByLesson.get(pl.id) ?? null;
    const held = slot ? HELD.includes(slot.status) : false;
    const isToday = slot ? dayKey(new Date(slot.starts_at)) === today : false;
    const off = slot ? !HELD.includes(slot.status) && slot.status !== 'scheduled' : false;
    return { pl, slot, held, isToday, off };
  });
  const doneCount = items.filter((i) => i.held).length;
  const next = items.find((i) => i.slot && !i.held && !i.off && new Date(i.slot.starts_at).getTime() > now - 3 * 3600e3);
  const current = items.find((i) => i.pl.n === selected) ?? next ?? items[items.length - 1];
  const days = (g.days ?? []).map((d) => t(`wd${d}` as never)).join(' & ');
  // "German Activation · Flow 3" -> eyebrow "German Activation · A2–B1", title "Flow 3"
  const title = g.program_title ?? g.name;
  const cut = title.lastIndexOf(' · ');
  const titleHead = cut > 0 ? title.slice(0, cut) : null;
  const titleMain = cut > 0 ? title.slice(cut + 3) : title;
  const guides = fileRows.filter((f) => !f.program_lesson_id);
  const badge = (i: (typeof items)[number]) => i.held ? t('c_done')
    : i.off && i.slot ? t(`st_${i.slot.status}` as never)
      : i.isToday ? t('c_today')
        : i.slot ? fmtDayInTz(i.slot.starts_at, g.tz, locale) : '';

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="course-top">
        <div className="course-head">
          <div className="eyebrow">{[titleHead, g.program_level].filter(Boolean).join(' · ')}</div>
          <h1>{titleMain}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {days}{g.start_time ? ` · ${g.start_time.slice(0, 5)} (${t('groupTime')})` : ''}
            {g.teacher_name ? ` · ${withName(g.teacher_name, locale)}` : ''}
            {items.length ? ` · ${t('c_doneOf', { n: doneCount, m: items.length })}` : ''}
          </p>
          {!next?.slot && g.zoom_url && (
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn small" href={g.zoom_url} target="_blank" rel="noreferrer"><IconVideo size={16} /> {t('regularZoom')}</a>
            </div>
          )}
        </div>
        {next?.slot ? (
          <section className="next-card" aria-label={t('c_next')}>
            <span className="next-when">{next.isToday ? t('c_today') : t('c_next')} · {fmtInTz(next.slot.starts_at, g.tz, locale)}</span>
            <strong className="next-title">{t('c_lesson', { n: next.pl.n })} · {next.pl.title}</strong>
            {next.pl.prepare && <span className="next-sub">{t('c_prepareHint')}</span>}
            {(next.slot.zoom_url ?? g.zoom_url)
              ? <a className="next-zoom" href={(next.slot.zoom_url ?? g.zoom_url)!} target="_blank" rel="noreferrer"><IconVideo size={18} />{t('c_join')}</a>
              : <span className="next-zoom off"><IconVideo size={18} />{t('zoomComing')}</span>}
          </section>
        ) : items.length > 0 && doneCount === items.length ? (
          <section className="next-card"><strong className="next-title">{t('c_allDone')}</strong></section>
        ) : null}
      </div>

      <div className="course">
        <nav className="card course-list" aria-label={t('c_lessons')}>
          <h2 style={{ margin: '4px 8px 8px', fontSize: 16 }}>{t('c_lessons')}</h2>
          {items.map((i) => (
            <Link key={i.pl.id} href={`${basePath}?l=${i.pl.n}#lesson`} scroll={false} className={`course-item ${current?.pl.id === i.pl.id ? 'active' : ''}`}
              aria-current={current?.pl.id === i.pl.id ? 'page' : undefined}>
              <span className="num">{i.pl.n}</span>
              <span className="ttl">{i.pl.title}</span>
              <span className={`tag ${i.held ? 'ok' : i.isToday ? 'today' : ''}`}>
                {badge(i)}{i.slot && hwBy.get(i.slot.id) ? (hwBy.get(i.slot.id)!.status === 'checked' ? ' · ✅' : ' · 📚') : ''}
              </span>
            </Link>
          ))}
        </nav>

        {current && (
          <article className="card course-detail" id="lesson">
            <div>
              <div className="eyebrow">{t('c_lesson', { n: current.pl.n })}{current.pl.topic ? ` · ${current.pl.topic}` : ''}</div>
              <h2 style={{ fontSize: 24, margin: '4px 0 0' }}>{current.pl.title}</h2>
              {current.slot && <p className="muted" style={{ margin: '4px 0 0' }}>{fmtInTz(current.slot.starts_at, g.tz, locale)}</p>}
            </div>
            {current.pl.goal && <p className="goal" style={{ margin: 0 }}>{current.pl.goal}</p>}
            {current.pl.rule && (
              <section>
                <h3>{t('c_rule')}</h3>
                <div className="rule-box"><RichText text={current.pl.rule} /></div>
              </section>
            )}
            {current.pl.prepare && !current.held && (
              <section>
                <h3>{t('c_before')}</h3>
                <RichText text={current.pl.prepare} />
              </section>
            )}
            {fileRows.some((f) => f.program_lesson_id === current.pl.id) && (
              <section>
                <h3>{t('c_files')}</h3>
                <div className="links">
                  {fileRows.filter((f) => f.program_lesson_id === current.pl.id).map((f) => (
                    <Link key={f.file_id} href={`${fileBase}/${f.file_id}`}>{f.title}</Link>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3>{t('c_after')}</h3>
              {current.held ? (
                <>
                  <div className="links" style={{ marginBottom: 10 }}>
                    {current.slot?.recording_url && <a href={current.slot.recording_url} target="_blank" rel="noreferrer">{t('c_watch')}</a>}
                    {(current.slot?.homework_url ?? current.pl.homework_url) && (
                      <a href={(current.slot?.homework_url ?? current.pl.homework_url)!} target="_blank" rel="noreferrer">{t('c_homework')}</a>
                    )}
                    {current.pl.vocab_url && <a href={current.pl.vocab_url} target="_blank" rel="noreferrer">{t('c_vocab')}</a>}
                    {current.pl.slides_url && <a href={current.pl.slides_url} target="_blank" rel="noreferrer">{t('c_slides')}</a>}
                  </div>
                  <RichText text={current.pl.after_note} />
                  {current.slot && (
                    <div className="hw-box">
                      <h3 style={{ marginTop: 0 }}>{t('hwMine')}</h3>
                      {preview || !meStudent ? (
                        <p className="muted" style={{ margin: 0 }}>{t('hwPreview')}</p>
                      ) : (() => {
                        const h = hwBy.get(current.slot.id);
                        return (
                          <>
                            {h && (
                              <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
                                <span className={`pill ${h.status === 'checked' ? 'ok' : ''}`}>
                                  {h.status === 'checked' ? t('hwChecked') : t('hwSentOn', { date: fmtDate(h.submitted_at, locale) })}
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
                            {h ? (
                              <details>
                                <summary>{t('hwAgain')}</summary>
                                <HomeworkForm mode="submit" lessonId={current.slot.id} studentId={meStudent}
                                  labels={homeworkLabels(t, 'submit')} path={basePath} />
                              </details>
                            ) : (
                              <HomeworkForm mode="submit" lessonId={current.slot.id} studentId={meStudent}
                                labels={homeworkLabels(t, 'submit')} path={basePath} />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>{t('c_opensAfter')}</p>
              )}
            </section>
            {current.pl.connected && (
              <section>
                <h3>{t('c_connected')}</h3>
                <RichText text={current.pl.connected} />
              </section>
            )}
          </article>
        )}

        <aside className="stack course-aside">
          <section className="card course-chat">
            <h2>{t('groupChat')}</h2>
            {peek.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('groupChatEmpty')}</p>}
            {peek.map((m) => (
              <div key={m.id} className="chat-peek">
                <strong>{nameOf.get(m.sender_id) ?? ''}:</strong> {m.body ?? (m.file_kind === 'audio' ? '🎤' : '📎')}
              </div>
            ))}
            {preview ? <span className="small-link muted">{t('openChat')}</span> : <Link href={`/chat?g=${g.id}`} className="small-link">{t('openChat')}</Link>}
          </section>
          {guides.length > 0 && (
            <section className="card">
              <h2 style={{ fontSize: 16 }}>{t('c_guides')}</h2>
              {guides.map((f) => (
                <Link key={f.file_id} href={`${fileBase}/${f.file_id}`} className="spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--sand)', color: 'var(--ink)', textDecoration: 'none' }}>
                  <span>{f.title}</span><span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 14 }}>{t('open')}</span>
                </Link>
              ))}
            </section>
          )}
          <section className="card" style={{ background: 'var(--sand)', borderColor: 'transparent' }}>
            <h2 style={{ fontSize: 15, marginBottom: 6 }}>{t('c_missed')}</h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5a524c' }}>{t('c_missedText')}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
