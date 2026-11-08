import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { fmtInTz, SCHOOL_TZ } from '@/lib/i18n';
import type { LessonDb } from '@/lib/lessons';
import { setLessonStatus } from '@/app/teacher/actions';
import { setRecording, toggleAbsence } from '@/app/groups/actions';

const OTHER = ['cancelled', 'force_majeure', 'rescheduled'];

export type Member = { student_id: string; name: string };

// A group lesson in the teacher's day: the topic and materials come from the
// program, the teacher taps who was missing, adds the recording and marks it held.
export default function GroupLessonCard({
  lesson, members, absent, t, locale, returnTo,
}: { lesson: LessonDb; members: Member[]; absent: Set<string>; t: T; locale: Locale; returnTo: string }) {
  const pl = lesson.program_lessons;
  const held = ['done', 'no_show', 'late_cancel'].includes(lesson.status);
  const present = members.filter((m) => !absent.has(m.student_id)).length;
  const homework = lesson.homework_url ?? pl?.homework_url;
  return (
    <article className="card group-lesson">
      <div className="spread">
        <div>
          <div style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtInTz(lesson.starts_at, lesson.groups?.tz ?? SCHOOL_TZ, locale)}{lesson.groups?.tz === 'Europe/Vienna' ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {t('groupTime')}</span> : null}</div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>
            {lesson.group_id ? <Link href={`/groups/${lesson.group_id}`} style={{ color: 'var(--ink)' }}>{lesson.groups?.name}</Link> : lesson.groups?.name}
          </div>
          {pl && <div className="muted">{t('lessonN', { n: pl.n })} · {pl.title}{pl.topic ? ` · ${pl.topic}` : ''}</div>}
        </div>
        <div className="row">
          {lesson.zoom_url && <a className="btn small" href={lesson.zoom_url} target="_blank" rel="noreferrer">Zoom</a>}
          {lesson.status !== 'scheduled' && <span className={`pill ${held ? 'ok' : ''}`}>{t(`st_${lesson.status}` as never)}</span>}
        </div>
      </div>

      {(pl?.slides_url || homework || pl?.vocab_url) && (
        <div className="links">
          {pl?.slides_url && <a href={pl.slides_url} target="_blank" rel="noreferrer">{t('slides')}</a>}
          {homework && <a href={homework} target="_blank" rel="noreferrer">{t('homework')}</a>}
          {pl?.vocab_url && <a href={pl.vocab_url} target="_blank" rel="noreferrer">{t('vocab')}</a>}
        </div>
      )}
      {pl?.teacher_note && (
        <details>
          <summary>{t('teacherNote')}</summary>
          <p style={{ margin: '8px 0 0' }}>{pl.teacher_note}</p>
        </details>
      )}

      {members.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="spread">
            <strong style={{ fontSize: 15 }}>{t('whoWasThere', { n: present, m: members.length })}</strong>
            <small>{t('tapIfAbsent')}</small>
          </div>
          <div className="chips">
            {members.map((m) => {
              const away = absent.has(m.student_id);
              return (
                <form key={m.student_id} action={toggleAbsence}>
                  <input type="hidden" name="lesson_id" value={lesson.id} />
                  <input type="hidden" name="student_id" value={m.student_id} />
                  <input type="hidden" name="absent" value={away ? '0' : '1'} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button type="submit" className={`chip ${away ? 'away' : ''}`} aria-pressed={!away}>
                    {m.name}{away ? ` · ${t('absentMark')}` : ''}
                  </button>
                </form>
              );
            })}
          </div>
        </div>
      )}

      <div className="spread" style={{ alignItems: 'flex-end' }}>
        <form action={setRecording} className="row" style={{ flex: '1 1 260px' }}>
          <input type="hidden" name="lesson_id" value={lesson.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <input name="recording_url" type="url" defaultValue={lesson.recording_url ?? ''} placeholder={t('recordingLink')}
            aria-label={t('recordingLink')} style={{ flex: '1 1 200px' }} />
          <input name="homework_url" type="url" defaultValue={lesson.homework_url ?? ''} placeholder={t('groupHomework')}
            aria-label={t('groupHomework')} title={t('groupHomeworkHint')} style={{ flex: '1 1 200px' }} />
          <button className="small" type="submit">{t('save')}</button>
        </form>
        <div className="row">
          {lesson.status !== 'done' && (
            <form action={setLessonStatus}>
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="status" value="done" />
              <input type="hidden" name="return_to" value={returnTo} />
              <button className="primary" type="submit">{t('markDone')}</button>
            </form>
          )}
          <form action={setLessonStatus} className="row">
            <input type="hidden" name="id" value={lesson.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select name="status" aria-label={t('status')} defaultValue="" required>
              <option value="" disabled>{t('markOther')}</option>
              {OTHER.concat(lesson.status !== 'scheduled' ? ['scheduled'] : []).map((s) => (
                <option key={s} value={s}>{t(`st_${s}` as never)}</option>
              ))}
            </select>
            <button className="small" type="submit">OK</button>
          </form>
        </div>
      </div>
    </article>
  );
}
