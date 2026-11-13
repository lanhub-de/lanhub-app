import type { Locale, T } from '@/lib/i18n';
import { addLesson } from '@/app/teacher/actions';
import Submit from '@/components/Submit';
import BookingFields, { type BookingLabels, type BookingWho } from '@/components/BookingFields';

export type Pick = BookingWho;

export function bookingLabels(t: T): BookingLabels {
  return {
    whoWith: t('whoWith'), once: t('bookOnce'), regular: t('bookRegular'), when: t('whenKyiv'), days: t('bookDays'),
    from: t('bookFrom'), count: t('bookCount'), preview: t('bookPreview'), left: t('bookLeft'), over: t('bookOver'),
    pickDay: t('bookPickDay'),
  };
}

// "Schedule a lesson": for teachers without a fixed timetable, a lesson is
// booked when it is agreed. Once, or regularly on several weekdays for as many
// lessons as the package has left. The school can also book trials and
// diagnostics, and lessons for an invited teacher who has not signed in yet.
export default function ScheduleLesson({
  t, locale, returnTo, students, groups = [], preselect, teacherId, pending, school, align = 'right', label,
}: {
  t: T; locale: Locale; returnTo: string; students: Pick[]; groups?: { id: string; name: string }[]; preselect?: string;
  teacherId?: string; pending?: string | null; school?: boolean; align?: 'left' | 'right'; label?: string;
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
        <BookingFields students={students} groups={groups} preselect={preselect} labels={bookingLabels(t)} locale={locale} />
        <label>
          {t('duration')}
          <select name="duration_min" defaultValue="60">
            <option value="45">45 {t('minShort')}</option>
            <option value="60">60 {t('minShort')}</option>
            <option value="90">90 {t('minShort')}</option>
          </select>
        </label>
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
