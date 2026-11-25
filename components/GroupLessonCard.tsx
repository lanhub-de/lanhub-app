import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { fmtDateTime, fmtInTz, localValueIn, SCHOOL_TZ } from '@/lib/i18n';
import { canDeleteBooking, lastDayMove, lengthChange, zoomOf, type LessonDb } from '@/lib/lessons';
import { fmtMoney } from '@/lib/i18n';
import { deleteLesson, moveLesson, repeatLesson, setLessonStatus } from '@/app/teacher/actions';
import { setRecording, toggleAbsence } from '@/app/groups/actions';
import Submit from '@/components/Submit';
import LessonMaterials, { type FileRef } from '@/components/LessonMaterials';

const OTHER = ['cancelled', 'force_majeure', 'rescheduled'];

export type Member = { student_id: string; name: string };

// A group lesson in the teacher's day. A lesson of the program takes its topic
// and materials from there; an extra lesson gets its topic from the teacher.
// She taps who was missing, adds the recording and marks it held. Like an
// individual lesson it can be moved (day, time, length), repeated a week later
// or, if booked by mistake, deleted; times are on the group's own clock.
export default function GroupLessonCard({
  lesson, members, absent, t, locale, returnTo, userId, school = false, materials, library,
}: {
  lesson: LessonDb; members: Member[]; absent: Set<string>; t: T; locale: Locale; returnTo: string;
  userId?: string; school?: boolean; materials?: FileRef[]; library?: FileRef[];
}) {
  const pl = lesson.program_lessons;
  const held = ['done', 'no_show', 'late_cancel'].includes(lesson.status);
  const present = members.filter((m) => !absent.has(m.student_id)).length;
  const homework = lesson.homework_url ?? pl?.homework_url;
  const tz = lesson.groups?.tz ?? SCHOOL_TZ;
  const tzName = tz === 'Europe/Vienna' ? t('groupTime') : tz === SCHOOL_TZ ? t('kyivTime') : tz;
  const moved = lastDayMove(lesson);
  const lengthChanged = lengthChange(lesson);
  // a teacher changes a lesson that is not marked yet; the school fixes any
  const canChange = school || lesson.status === 'scheduled' || lesson.status === 'rescheduled';
  return (
    <article className="card group-lesson">
      <div className="spread">
        <div>
          <div style={{ fontWeight: 700, color: 'var(--red)' }}>
            {fmtInTz(lesson.starts_at, tz, locale)}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {lesson.duration_min} {t('minShort')}{tz !== SCHOOL_TZ ? ` · ${tzName}` : ''}</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>
            {lesson.group_id ? <Link href={`/groups/${lesson.group_id}`} style={{ color: 'var(--ink)' }}>{lesson.groups?.name}</Link> : lesson.groups?.name}
          </div>
          {pl
            ? <div className="muted">{t('lessonN', { n: pl.n })} · {pl.title}{pl.topic ? ` · ${pl.topic}` : ''}</div>
            : <div className="muted">{t('extraLesson')}{lesson.note ? ` · ${lesson.note}` : ''}</div>}
          {moved && (
            <div className="moved-note">
              ↪ {t('movedFrom', { when: tz === SCHOOL_TZ ? fmtDateTime(moved.from, locale) : fmtInTz(moved.from, tz, locale) })}
              {moved.late && <span className="pill warn">{t('movedLate')}</span>}
            </div>
          )}
          {lengthChanged && (
            <div className="moved-note">⏱ {lengthChanged.from} → {lengthChanged.to} {t('minShort')}</div>
          )}
        </div>
        <div className="row">
          {zoomOf(lesson)
            ? <a className="btn small" href={zoomOf(lesson)!} target="_blank" rel="noreferrer">🎥 Zoom</a>
            : <span className="muted" style={{ fontSize: 13 }}>{t('noZoomGroup')}</span>}
          {lesson.status !== 'scheduled' && (
            <span className={`pill ${held ? 'ok' : lesson.status === 'rescheduled' ? 'warn' : ''}`}>
              {t(`st_${lesson.status}` as never)}{held && lesson.lesson_pay?.amount ? ` · +${fmtMoney(Number(lesson.lesson_pay.amount))}` : ''}
            </span>
          )}
        </div>
      </div>

      {lesson.status === 'rescheduled' && <div className="attention">{t('rescheduledHint')}</div>}

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
                  <Submit className={`chip ${away ? 'away' : ''}`} ariaPressed={!away}>
                    {m.name}{away ? ` · ${t('absentMark')}` : ''}
                  </Submit>
                </form>
              );
            })}
          </div>
        </div>
      )}

      <div className="spread group-actions" style={{ alignItems: 'flex-end' }}>
        <form action={setRecording} className="row" style={{ flex: '1 1 260px' }}>
          <input type="hidden" name="lesson_id" value={lesson.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          {!pl && (
            <input name="note" defaultValue={lesson.note ?? ''} placeholder={t('lessonTopic')} aria-label={t('lessonTopic')}
              maxLength={300} style={{ flex: '1 1 200px' }} />
          )}
          <input name="recording_url" type="url" defaultValue={lesson.recording_url ?? ''} placeholder={t('recordingLink')}
            aria-label={t('recordingLink')} style={{ flex: '1 1 200px' }} />
          <input name="homework_url" type="url" defaultValue={lesson.homework_url ?? ''} placeholder={t('groupHomework')}
            aria-label={t('groupHomework')} title={t('groupHomeworkHint')} style={{ flex: '1 1 200px' }} />
          <Submit className="small">{t('save')}</Submit>
        </form>
        <div className="row">
          {canChange && (
            <details className="move">
              <summary className="btn">{t('btnMove')}</summary>
              <div className="move-form">
                <form action={moveLesson} className="stack" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{t('moveTitle')}</strong>
                  <input type="hidden" name="id" value={lesson.id} />
                  <input type="hidden" name="tz" value={tz} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <label>{t('newTimeIn', { tz: tzName })}<input type="datetime-local" name="starts_at" required defaultValue={localValueIn(lesson.starts_at, tz)} /></label>
                  <label>
                    {t('duration')}
                    <select name="duration_min" defaultValue={String(lesson.duration_min ?? 90)}>
                      {[45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} {t('minShort')}</option>)}
                    </select>
                  </label>
                  <Submit className="primary small">{t('save')}</Submit>
                  <small className="muted">{t('moveHintGroup')}</small>
                </form>
                <form action={repeatLesson} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <input type="hidden" name="id" value={lesson.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <Submit className="small">↻ {t('repeatNextWeek')}</Submit>
                  <small className="muted">{t('repeatNextWeekGroup')}</small>
                </form>
                {canDeleteBooking(lesson, userId, school) && (
                  <details className="delete-booking">
                    <summary className="link-btn">{t(school ? 'deleteLesson' : 'deleteBooking')}</summary>
                    <form action={deleteLesson} className="stack" style={{ gap: 6 }}>
                      <input type="hidden" name="id" value={lesson.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <small className="muted">{t(school ? 'deleteLessonHint' : 'deleteBookingHint')}</small>
                      <Submit className="small danger">{t('deleteConfirm')}</Submit>
                    </form>
                  </details>
                )}
              </div>
            </details>
          )}
          {lesson.status !== 'done' && (
            <form action={setLessonStatus}>
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="status" value="done" />
              <input type="hidden" name="return_to" value={returnTo} />
              <Submit className="primary">{t('markDone')}</Submit>
            </form>
          )}
          <form action={setLessonStatus} className="row">
            <input type="hidden" name="id" value={lesson.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select name="status" aria-label={t('status')} defaultValue="" required>
              <option value="" disabled>{t('markOther')}</option>
              {OTHER.concat(lesson.status !== 'scheduled' ? ['scheduled'] : []).filter((s) => s !== lesson.status).map((s) => (
                <option key={s} value={s}>{t(`st_${s}` as never)}</option>
              ))}
            </select>
            <Submit className="small">OK</Submit>
          </form>
        </div>
      </div>
      {/* an extra lesson has no program materials: the teacher attaches her own */}
      {!pl && library && (
        <LessonMaterials lessonId={lesson.id} t={t} returnTo={returnTo} materials={materials} library={library} userId={userId} />
      )}
    </article>
  );
}
