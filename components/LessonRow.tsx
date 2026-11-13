import type { Locale, T } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/i18n';
import { setLessonStatus } from '@/app/teacher/actions';
import Submit from '@/components/Submit';

export type LessonView = {
  id: string;
  starts_at: string;
  status: string;
  kind: string;
  zoom_url: string | null;
  teacher_name?: string;
  who: string;
  level?: string | null;
};

const OTHER = ['no_show', 'late_cancel', 'cancelled', 'force_majeure', 'rescheduled'];

// One lesson with the buttons to mark how it went.
export default function LessonRow({
  lesson, t, locale, returnTo, canMark,
}: { lesson: LessonView; t: T; locale: Locale; returnTo: string; canMark: boolean }) {
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
      </div>
    </div>
  );
}
