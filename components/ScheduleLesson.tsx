import type { T } from '@/lib/i18n';
import { addLesson } from '@/app/teacher/actions';
import Submit from '@/components/Submit';

export type Pick = { id: string; name: string; level?: string | null };

// "Schedule a lesson": for teachers without a fixed timetable, a lesson is
// booked when it is agreed. One time, or the same time every week for a few
// weeks. The school can also book trials and diagnostics, and lessons for an
// invited teacher who has not signed in yet.
export default function ScheduleLesson({
  t, returnTo, students, groups = [], preselect, teacherId, pending, school, align = 'right', label,
}: {
  t: T; returnTo: string; students: Pick[]; groups?: Pick[]; preselect?: string; teacherId?: string;
  pending?: string | null; school?: boolean; align?: 'left' | 'right'; label?: string;
}) {
  if (!students.length && !groups.length) return null;
  return (
    <details className="move schedule">
      <summary className="btn primary">+ {label ?? t('scheduleLesson')}</summary>
      <form action={addLesson} className={`move-form schedule-form ${align === 'left' ? 'left' : ''}`}>
        <strong style={{ fontSize: 16 }}>{t('scheduleLesson')}</strong>
        <input type="hidden" name="return_to" value={returnTo} />
        {teacherId && <input type="hidden" name="teacher_id" value={teacherId} />}
        {pending && <input type="hidden" name="pending" value={pending} />}
        <label>
          {t('whoWith')}
          <select name="who" required defaultValue={preselect ?? ''}>
            <option value="" disabled>…</option>
            {students.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}{s.level ? ` · ${s.level}` : ''}</option>)}
            {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
          </select>
        </label>
        <label>{t('whenKyiv')}<input type="datetime-local" name="starts_at" required /></label>
        <div className="schedule-two">
          <label>
            {t('duration')}
            <select name="duration_min" defaultValue="60">
              <option value="45">45 {t('minShort')}</option>
              <option value="60">60 {t('minShort')}</option>
              <option value="90">90 {t('minShort')}</option>
            </select>
          </label>
          <label>
            {t('repeat')}
            <select name="repeat" defaultValue="1">
              <option value="1">{t('repeatOnce')}</option>
              <option value="4">{t('repeat4')}</option>
              <option value="8">{t('repeat8')}</option>
            </select>
          </label>
        </div>
        {school && (
          <label>
            {t('lessonKind')}
            <select name="kind" defaultValue="individual">
              <option value="individual">{t('kind_individual')}</option>
              <option value="trial">{t('kind_trial')}</option>
              <option value="diagnostic">{t('kind_diagnostic')}</option>
            </select>
          </label>
        )}
        <label>
          {t('zoomLink')}
          <input type="url" name="zoom_url" placeholder={t('zoomOptional')} />
        </label>
        <Submit className="primary">{t('scheduleSave')}</Submit>
        <small className="muted">{t('scheduleHint')}</small>
      </form>
    </details>
  );
}
