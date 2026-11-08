import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { SCHOOL_TZ } from '@/lib/i18n';
import { zoomOf, type LessonDb } from '@/lib/lessons';
import { fmtMoney } from '@/lib/i18n';
import { attachLessonFile, detachLessonFile, moveLesson, saveLessonPlan, setLessonStatus } from '@/app/teacher/actions';
import LessonFileUpload from '@/components/LessonFileUpload';
import Submit from '@/components/Submit';

export type FileRef = { id: string; title: string; level?: string | null };

const OTHER = ['late_cancel', 'cancelled', 'force_majeure'];

function timeIn(iso: string, tz: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function dayIn(iso: string, tz: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}
// the value for <input type="datetime-local"> in Kyiv time
function localValue(iso: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

// An individual lesson in the teacher's day, as in the mockup: the time, who,
// and three buttons. Anything else (cancelled in time, force majeure) under "…".
export default function TodayLessonCard({
  lesson, t, locale, returnTo, showDay, materials = [], library = [], userId, teacherZoom,
}: {
  lesson: LessonDb; t: T; locale: Locale; returnTo: string; showDay?: boolean;
  materials?: FileRef[]; library?: FileRef[]; userId?: string; teacherZoom?: string | null;
}) {
  const zoom = zoomOf(lesson, teacherZoom);
  const paid = lesson.lesson_pay?.amount != null && Number(lesson.lesson_pay.amount) > 0 ? Number(lesson.lesson_pay.amount) : null;
  const held = ['done', 'no_show', 'late_cancel'].includes(lesson.status);
  const who = lesson.students?.full_name ?? lesson.groups?.name ?? '';
  const level = lesson.students?.level ?? lesson.groups?.level;
  const status = (s: string, label: string, cls = '') => (
    <form action={setLessonStatus}>
      <input type="hidden" name="id" value={lesson.id} />
      <input type="hidden" name="status" value={s} />
      <input type="hidden" name="return_to" value={returnTo} />
      <Submit className={cls}>{label}</Submit>
    </form>
  );
  return (
    <article className="card today-card">
      <div className="today-top">
        <div className="today-when">
          <span className="today-time">{timeIn(lesson.starts_at, SCHOOL_TZ, locale)}</span>
          {showDay && <span className="muted" style={{ fontSize: 13 }}>{dayIn(lesson.starts_at, SCHOOL_TZ, locale)}</span>}
        </div>
        <div className="today-who">
          <strong>{who}{level ? ` · ${level}` : ''}</strong>
          <span className="muted">{t(`kind_${lesson.kind}` as never)}</span>
        </div>
        <div className="today-actions">
          {lesson.status === 'scheduled' ? (
            <>
              {status('no_show', t('btnNoShow'))}
              <details className="move">
                <summary className="btn">{t('btnMove')}</summary>
                <form action={moveLesson} className="move-form">
                  <input type="hidden" name="id" value={lesson.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <label>{t('newTime')}<input type="datetime-local" name="starts_at" required defaultValue={localValue(lesson.starts_at)} /></label>
                  <Submit className="primary small">{t('save')}</Submit>
                </form>
              </details>
              {status('done', t('markDone'), 'primary')}
            </>
          ) : (
            <>
              <span className={`pill ${held ? 'ok' : ''}`}>{t(`st_${lesson.status}` as never)}{held && paid ? ` · +${fmtMoney(paid)}` : ''}</span>
              {status('scheduled', t('undo'), 'small')}
            </>
          )}
        </div>
      </div>
      <div className="today-bottom">
        <span className="row" style={{ gap: 14 }}>
          {zoom
            ? <a href={zoom} target="_blank" rel="noreferrer" className="zoom-link">🎥 {t('joinZoom')}</a>
            : <span className="muted">{t('noZoom')}</span>}
        </span>
        <span className="row" style={{ gap: 12 }}>
          {lesson.status === 'scheduled' && (
            <details className="more">
              <summary>…</summary>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {OTHER.map((s) => <span key={s}>{status(s, t(`st_${s}` as never), 'small')}</span>)}
              </div>
            </details>
          )}
        </span>
      </div>
      <details className="plan">
        <summary>
          {lesson.note || lesson.homework_text || lesson.recording_url ? (
            <span className="plan-sum">
              {lesson.note && <span><span className="muted">{t('lessonTopic')}:</span> {lesson.note}</span>}
              {lesson.homework_text && <span><span className="muted">{t('hwTask')}:</span> {lesson.homework_text}</span>}
              {lesson.recording_url && <span><span className="muted">{t('recordingWord')}:</span> ▶ {t('recordingAdded')}</span>}
            </span>
          ) : <span className="link-btn">+ {t('topicHomeworkRecording')}</span>}
        </summary>
        <form action={saveLessonPlan} className="plan-form">
          <input type="hidden" name="id" value={lesson.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label>{t('lessonTopic')}<input name="note" defaultValue={lesson.note ?? ''} placeholder="worauf / darauf" maxLength={300} /></label>
          <label>{t('hwTask')}<textarea name="homework_text" rows={2} defaultValue={lesson.homework_text ?? ''} maxLength={4000} /></label>
          <label>{t('recordingLink')}<input type="url" name="recording_url" defaultValue={lesson.recording_url ?? ''} placeholder="https://…" /></label>
          <Submit className="primary small">{t('save')}</Submit>
        </form>
      </details>
      <div className="materials">
        <span className="muted" style={{ fontSize: 13 }}>{t('lessonMaterials')}:</span>
        {materials.map((f) => (
          <span key={f.id} className="file-chip">
            <Link href={`/library/${f.id}`}>📄 {f.title}</Link>
            <form action={detachLessonFile}>
              <input type="hidden" name="lesson_id" value={lesson.id} />
              <input type="hidden" name="file_id" value={f.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <Submit ariaLabel={t('remove')} title={t('remove')}>×</Submit>
            </form>
          </span>
        ))}
        {library.length > 0 && (
          <details className="move">
            <summary className="link-btn">+ {t('fromLibrary')}</summary>
            <form action={attachLessonFile} className="move-form">
              <input type="hidden" name="lesson_id" value={lesson.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <select name="file_id" required defaultValue="">
                <option value="" disabled>…</option>
                {library.filter((f) => !materials.some((m) => m.id === f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.title}{f.level ? ` · ${f.level}` : ''}</option>
                ))}
              </select>
              <Submit className="primary small">{t('add')}</Submit>
            </form>
          </details>
        )}
        {userId && <LessonFileUpload lessonId={lesson.id} userId={userId} label={t('ownFile')} failed={t('chatFailed')} />}
      </div>
    </article>
  );
}
