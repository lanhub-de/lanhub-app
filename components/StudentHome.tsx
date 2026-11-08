import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import HomeworkDrop from '@/components/HomeworkDrop';
import HomeworkView from '@/components/HomeworkView';
import NextWhen from '@/components/NextWhen';
import ShortDate from '@/components/ShortDate';
import ChatPeek, { type PeekMessage } from '@/components/ChatPeek';
import { IconCards, IconFile, IconPen, IconUpload, IconVideo } from '@/components/Icons';
import type { Locale, T } from '@/lib/i18n';
import { HOMEWORK_COLUMNS, dropLabels, withFileLinks, type Homework } from '@/lib/homework';
import { chatWith, withName } from '@/lib/names';
import { dayMonth } from '@/lib/when';
import BeforeTitle from '@/components/BeforeTitle';

type Lesson = {
  id: string; starts_at: string; duration_min: number; status: string; zoom_url: string | null;
  recording_url: string | null; homework_url: string | null; note: string | null; homework_text: string | null;
  teacher_id: string; teacher_name: string | null; student_id: string;
};
type Msg = { id: string; sender_id: string; body: string | null; file_kind: string | null };
type FileRow = { lesson_id: string; files: { id: string; title: string } | null };

const HELD = ['done', 'no_show', 'late_cancel'];

// The individual student's home, as in the mockup (StudentDesktop on a
// computer, Student on a phone): the next lesson with Zoom, what to open
// before it, homework with hand-in, her lessons, the package and the chat
// with her teacher. The school and her teacher see the same page (preview),
// where nothing can be sent.
export default async function StudentHome({
  supabase, studentId, t, locale, preview, groups = [],
}: {
  supabase: SupabaseClient; studentId: string; t: T; locale: Locale; preview?: boolean;
  groups?: { id: string; name: string; program_title: string | null }[];
}) {
  const now = Date.now();
  const from = new Date(now - 90 * 864e5).toISOString();
  const to = new Date(now + 60 * 864e5).toISOString();
  const [studentRes, teacherRes, lessonsRes, pkgRes, chatRes] = await Promise.all([
    supabase.from('students').select('id, full_name, level, goodnotes_url, quizlet_url, schedule_note').eq('id', studentId).maybeSingle(),
    supabase.rpc('student_teacher', { sid: studentId }),
    supabase.rpc('student_lessons', { sid: studentId, p_from: from, p_to: to }),
    supabase.from('package_usage').select('lessons_total, lessons_used, lessons_left, valid_until').eq('student_id', studentId).eq('status', 'active').maybeSingle(),
    supabase.from('conversations').select('id').eq('kind', 'direct').eq('student_id', studentId).limit(1).maybeSingle(),
  ]);
  const s = studentRes.data as { id: string; full_name: string; level: string | null; goodnotes_url: string | null; quizlet_url: string | null; schedule_note: string | null } | null;
  if (!s) return <p className="muted">{t('nothingHere')}</p>;
  const teacher = ((teacherRes.data ?? []) as { teacher_id: string | null; teacher_name: string | null; can_chat: boolean }[])[0];
  const lessons = (lessonsRes.data ?? []) as Lesson[];
  const ids = lessons.map((l) => l.id);
  const cid = (chatRes.data as { id: string } | null)?.id ?? null;
  const [hwRes, filesRes, msgsRes] = await Promise.all([
    ids.length ? supabase.from('homework').select(HOMEWORK_COLUMNS).in('lesson_id', ids) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from('lesson_files').select('lesson_id, files(id, title)').in('lesson_id', ids).returns<FileRow[]>()
      : Promise.resolve({ data: [] as FileRow[] }),
    cid
      ? supabase.from('messages').select('id, sender_id, body, file_kind').eq('conversation_id', cid).order('created_at', { ascending: false }).limit(3)
      : Promise.resolve({ data: [] as Msg[] }),
  ]);
  const homework = await withFileLinks(supabase, (hwRes.data ?? []) as Homework[]);
  const hwBy = new Map(homework.map((h) => [h.lesson_id, h]));
  const files = (filesRes.data ?? []) as FileRow[];
  const filesOf = (lid: string) => files.filter((f) => f.lesson_id === lid && f.files).map((f) => f.files!);

  const upcoming = lessons.filter((l) => l.status === 'scheduled' && new Date(l.starts_at).getTime() > now - 2 * 3600e3);
  const past = lessons.filter((l) => !upcoming.includes(l) && new Date(l.starts_at).getTime() <= now + 3600e3).reverse();
  const held = past.filter((l) => HELD.includes(l.status));
  const next = upcoming[0];
  const lastHeld = held[0];
  const lastHw = lastHeld ? hwBy.get(lastHeld.id) : undefined;
  const prevChecked = held.slice(1).find((l) => hwBy.get(l.id)?.status === 'checked');
  const prevHw = prevChecked ? hwBy.get(prevChecked.id) : undefined;
  const pkg = pkgRes.data as { lessons_total: number; lessons_used: number; lessons_left: number; valid_until: string | null } | null;
  const tName = teacher?.teacher_name ?? '';
  const first = s.full_name.split(' ')[0];
  const fileHref = (id: string) => (preview ? `/library/${id}` : `/me/files/${id}`);
  const nextFiles = next ? filesOf(next.id) : [];
  const lastFiles = lastHeld ? filesOf(lastHeld.id) : [];
  const statusOf = (l: Lesson) => {
    if (l.status === 'done') return { text: t('st_done'), ok: true };
    if (l.status === 'no_show') return { text: t('stuNoShow'), ok: false };
    if (l.status === 'late_cancel') return { text: t('stuLate'), ok: false };
    if (l.status === 'cancelled' || l.status === 'rescheduled') return { text: t('stuCancelled'), ok: false };
    if (l.status === 'scheduled') return { text: t('stuNotMarked'), ok: false };
    return { text: t(`st_${l.status}` as never), ok: false };
  };
  const msgs: PeekMessage[] = ((msgsRes.data ?? []) as Msg[]).reverse().map((m) => ({
    id: m.id, mine: m.sender_id !== teacher?.teacher_id, text: m.body ?? (m.file_kind === 'audio' ? '🎤' : '📎'),
  }));

  return (
    <div className="s-home">
      <div className="s-main">
        <div className="s-hello o-hello">
          <h1>{t('meTitle', { name: first })}</h1>
          <p className="muted">
            {[s.level, tName ? t('withTeacher', { name: tName.split(' ')[0] }) : null, s.schedule_note].filter(Boolean).join(' · ')}
          </p>
        </div>

        <section className="s-next o-next" aria-label={t('c_next')}>
          <div className="s-next-text">
            <h2>{t('c_next')}</h2>
            {next ? (
              <>
                <div className="s-next-when"><NextWhen iso={next.starts_at} locale={locale} today={t('c_today')} tomorrow={t('c_tomorrow')} /></div>
                <div>{[tName ? withName(tName, locale) : null, s.level, next.note].filter(Boolean).join(' · ')}</div>
              </>
            ) : (
              <div className="s-next-when" style={{ fontSize: 19 }}>{t('meNoUpcoming')}</div>
            )}
          </div>
          {next && (next.zoom_url
            ? <a className="s-zoom" href={next.zoom_url} target="_blank" rel="noreferrer"><IconVideo />{t('c_join')}</a>
            : <span className="s-zoom off"><IconVideo />{t('zoomComing')}</span>)}
        </section>

        <div className="s-duo">
          <section className="card s-card o-before">
            <h2 className="s-h">{next ? <BeforeTitle iso={next.starts_at} today={t('beforeToday')} next={t('beforeNext')} /> : t('beforeNext')}</h2>
            <div className="s-list">
              {(next ? nextFiles : lastFiles).map((f) => (
                <Link key={f.id} href={fileHref(f.id)} className="s-row">
                  <span><IconFile />{f.title}</span><span className="open-link">{t('open')}</span>
                </Link>
              ))}
              {s.goodnotes_url && (
                <a href={s.goodnotes_url} target="_blank" rel="noreferrer" className="s-row">
                  <span><IconPen />GoodNotes</span><span className="open-link">{t('open')}</span>
                </a>
              )}
              {s.quizlet_url && (
                <a href={s.quizlet_url} target="_blank" rel="noreferrer" className="s-row">
                  <span><IconCards />Quizlet</span><span className="open-link">{t('open')}</span>
                </a>
              )}
              {lastHeld?.recording_url && (
                <a href={lastHeld.recording_url} target="_blank" rel="noreferrer" className="s-row">
                  <span><IconVideo size={18} />{t('lastRecording')}</span><span className="open-link">{t('watch')}</span>
                </a>
              )}
            </div>
            {!(next ? nextFiles : lastFiles).length && !s.goodnotes_url && !s.quizlet_url && !lastHeld?.recording_url && (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('noMaterialsYet')}</p>
            )}
          </section>

          <section className="card s-card o-hw">
            <div className="spread" style={{ alignItems: 'baseline' }}>
              <h2 className="s-h">{t('hwTitle')}</h2>
              {lastHeld && <span className="muted" style={{ fontSize: 14 }}>{t('afterLessonOn', { date: dayMonth(lastHeld.starts_at, locale) })}</span>}
            </div>
            {!lastHeld && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('hwNoneYet')}</p>}
            {lastHeld && (
              <>
                {(lastHeld.homework_text || lastHeld.note) && (
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {lastHeld.homework_text ? `${lastHeld.note ? `${lastHeld.note}: ` : ''}${lastHeld.homework_text}` : lastHeld.note}
                  </p>
                )}
                {lastHeld.homework_url && <a href={lastHeld.homework_url} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600 }}>{t('hwOpenTask')} ↗</a>}
                {lastHw ? (
                  <>
                    <div className={`s-sent ${lastHw.status === 'checked' ? 'checked' : ''}`}>
                      <span>
                        {lastHw.status === 'checked'
                          ? t('hwCheckedBy', { name: tName.split(' ')[0] })
                          : `${lastHw.file_name ?? t('hwText')} · ${t('hwSentTo', { name: tName.split(' ')[0] })}`}
                      </span>
                      {!preview && lastHw.status !== 'checked' && (
                        <details className="s-replace">
                          <summary className="btn small">{t('hwReplaceShort')}</summary>
                          <HomeworkDrop lessonId={lastHeld.id} studentId={studentId} path="/me" labels={dropLabels(t)} />
                        </details>
                      )}
                    </div>
                    {lastHw.status === 'checked' && (lastHw.feedback || lastHw.feedback_url) && (
                      <div className="hw-feedback">
                        <strong>{t('hwTeacherSays')}</strong>
                        <HomeworkView body={lastHw.feedback} url={lastHw.feedback_url} kind={lastHw.feedback_file_kind} name={lastHw.feedback_file_name} />
                      </div>
                    )}
                  </>
                ) : preview ? (
                  <div className="hw-drop" aria-disabled="true">
                    <IconUpload />
                    <span className="muted">{t('hwDropHint')}</span>
                    <span className="btn primary" style={{ opacity: .6 }}>{t('hwChoose')}</span>
                  </div>
                ) : (
                  <HomeworkDrop lessonId={lastHeld.id} studentId={studentId} path="/me" labels={dropLabels(t)} />
                )}
              </>
            )}
            {prevChecked && prevHw && (
              prevHw.feedback_url ? (
                <a href={prevHw.feedback_url} target="_blank" rel="noreferrer" className="s-prev">
                  <span>{[prevChecked.note, t('hwCheckedBy', { name: tName.split(' ')[0] })].filter(Boolean).join(' · ')}</span>
                  <span className="open-link">{t('hwDownloadComments')}</span>
                </a>
              ) : (
                <details className="s-prev">
                  <summary>
                    <span>{[prevChecked.note ?? <ShortDate key="d" iso={prevChecked.starts_at} locale={locale} />, ' · ', t('hwCheckedBy', { name: tName.split(' ')[0] })]}</span>
                    <span className="open-link">{t('hwSeeComment')}</span>
                  </summary>
                  {prevHw.feedback && <div className="hw-feedback" style={{ marginTop: 8 }}><HomeworkView body={prevHw.feedback} url={null} kind={null} name={null} /></div>}
                </details>
              )
            )}
          </section>
        </div>

        <section className="card s-card o-hist">
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <h2 className="s-h">{t('meUpcoming')}</h2>
            {!preview && upcoming.length > 1 && <Link href="/me/schedule" className="small-link">{t('navSchedule')} →</Link>}
          </div>
          {past.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('stuNoLessons')}</p>}
          <div className="s-hist">
            {past.slice(0, 8).map((l) => {
              const st = statusOf(l);
              return (
                <div key={l.id} className="s-hist-row">
                  <span>
                    <span className="muted tnum"><ShortDate iso={l.starts_at} locale={locale} /></span>
                    {l.note ? ` · ${l.note}` : ''}
                    {l.recording_url && <> · <a href={l.recording_url} target="_blank" rel="noreferrer">{t('recordingShort')}</a></>}
                    {hwBy.get(l.id)?.status === 'checked' ? ' · ✅' : hwBy.get(l.id) ? ' · 📚' : ''}
                  </span>
                  <span className={st.ok ? 's-ok' : 'muted'} style={{ fontSize: 13 }}>{st.text}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="s-side">
        <section className="card s-card o-pkg">
          <div className="spread" style={{ alignItems: 'baseline' }}>
            <h2 className="s-h">{t('mePackage')}{s.level ? ` ${s.level}` : ''}</h2>
            {pkg && <span className="muted" style={{ fontSize: 14 }}>{t('pkgOf', { n: pkg.lessons_used, m: pkg.lessons_total })}</span>}
          </div>
          {pkg ? (
            <>
              <div className="s-bar" role="img" aria-label={t('pkgOf', { n: pkg.lessons_used, m: pkg.lessons_total })}
                style={{ gridTemplateColumns: `repeat(${pkg.lessons_total}, minmax(0, 1fr))` }}>
                {Array.from({ length: pkg.lessons_total }, (_, i) => <span key={i} className={i < pkg.lessons_used ? 'on' : ''} />)}
              </div>
              {pkg.valid_until && <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>{t('validUntilCap', { date: dayMonth(pkg.valid_until, locale) })}</p>}
            </>
          ) : <p className="muted" style={{ margin: '8px 0 0', fontSize: 14 }}>{t('noPackageStudent')}</p>}
          {preview ? <span className="s-outline">{t('renewPackage')}</span> : <Link href="/chat" className="s-outline">{t('renewPackage')}</Link>}
        </section>

        <div className="o-chat">
          <ChatPeek
            title={tName ? chatWith(tName, locale) : t('schoolChat')}
            messages={msgs}
            conversationId={cid}
            studentId={studentId}
            teacherId={teacher?.can_chat ? teacher.teacher_id : null}
            canWrite={!!teacher?.can_chat}
            preview={preview}
            placeholder={t('chatPlaceholder')}
            sendLabel={t('send')}
            openLabel={t('openChat')}
            emptyText={teacher?.can_chat ? t('chatEmpty') : t('chatAfterSignIn', { name: tName.split(' ')[0] || t('teacherWord') })}
            failed={t('chatFailed')}
          />
        </div>

        {groups.length > 0 && (
          <section className="card s-card o-groups">
            <h2 className="s-h">{t('myGroups')}</h2>
            <div className="s-list">
              {groups.map((g) => (
                <Link key={g.id} href={preview ? `/groups/${g.id}/preview` : `/me/groups/${g.id}`} className="s-row">
                  <span>{g.program_title ?? g.name}</span><span className="open-link">{t('open')}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
