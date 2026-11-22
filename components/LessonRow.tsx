import type { Locale, T } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/i18n';
import { deleteLesson, moveLesson, setLessonStatus } from '@/app/teacher/actions';
import Submit from '@/components/Submit';

export type LessonView = {
  id: string;
  starts_at: string;
  duration_min?: number;
  status: string;
  kind: string;
  zoom_url: string | null;
  teacher_name?: string;
  who: string;
  level?: string | null;
  moved?: { from: string; late: boolean } | null;
  lengthChanged?: { from: number; to: number } | null;
};

const OTHER = ['no_show', 'late_cancel', 'cancelled', 'force_majeure', 'rescheduled'];

function localValue(iso: string) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// One lesson with the buttons to mark how it went. In the school's journal
// (canEdit) also: change the day, time or length, or delete a wrong lesson.
export default function LessonRow({
  lesson, t, locale, returnTo, canMark, canEdit = false,
}: { lesson: LessonView; t: T; locale: Locale; returnTo: string; canMark: boolean; canEdit?: boolean }) {
  // green only for a lesson actually held: the only one a teacher is paid for
  const counted = lesson.status === 'done';
  return (
    <div className="card spread">
      <div>
        <div style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtDateTime(lesson.starts_at, locale)}</div>
        <div style={{ fontWeight: 600 }}>
          {lesson.who}{lesson.level ? ` · ${lesson.level}` : ''}
        </div>
        <div className="muted">
          {t(`kind_${lesson.kind}` as never)}
          {lesson.teacher_name ? ` · ${lesson.teacher_name}` : ''}
          {lesson.zoom_url ? <> · <a href={lesson.zoom_url} target="_blank" rel="noreferrer">Zoom</a></> : null}
        </div>
        {lesson.moved && (
          <div className="moved-note">
            ↪ {t('movedFrom', { when: fmtDateTime(lesson.moved.from, locale) })}
            {lesson.moved.late && <span className="pill warn">{t('movedLate')}</span>}
          </div>
        )}
        {lesson.lengthChanged && (
          <div className="moved-note">⏱ {lesson.lengthChanged.from} → {lesson.lengthChanged.to} {t('minShort')}</div>
        )}
      </div>
      <div className="row">
        {lesson.status !== 'scheduled' && (
          <span className={`pill ${counted ? 'ok' : ''}`}>{t(`st_${lesson.status}` as never)}</span>
        )}
        {canMark && (
          <>
            {lesson.status !== 'done' && (
              <form action={setLessonStatus}>
                <input type="hidden" name="id" value={lesson.id} />
                <input type="hidden" name="status" value="done" />
                <input type="hidden" name="return_to" value={returnTo} />
                <Submit className="primary small">{t('markDone')}</Submit>
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
              <Submit className="small">OK</Submit>
            </form>
          </>
        )}
        {canEdit && (
          <details className="move">
            <summary className="btn small">{t('btnMove')}</summary>
            <div className="move-form">
              <form action={moveLesson} className="stack" style={{ gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{t('moveTitle')}</strong>
                <input type="hidden" name="id" value={lesson.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <label>{t('newTime')}<input type="datetime-local" name="starts_at" required defaultValue={localValue(lesson.starts_at)} /></label>
                <label>
                  {t('duration')}
                  <select name="duration_min" defaultValue={String(lesson.duration_min ?? 60)}>
                    {[45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} {t('minShort')}</option>)}
                  </select>
                </label>
                <Submit className="primary small">{t('save')}</Submit>
              </form>
              <details className="delete-booking">
                <summary className="link-btn">{t('deleteLesson')}</summary>
                <form action={deleteLesson} className="stack" style={{ gap: 6 }}>
                  <input type="hidden" name="id" value={lesson.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <small className="muted">{t('deleteLessonHint')}</small>
                  <Submit className="small danger">{t('deleteConfirm')}</Submit>
                </form>
              </details>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
