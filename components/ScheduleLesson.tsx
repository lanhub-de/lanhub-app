import type { Locale, T } from '@/lib/i18n';
import { addLesson } from '@/app/teacher/actions';
import Submit from '@/components/Submit';
import BookingFields, { type BookingGroup, type BookingLabels, type BookingWho } from '@/components/BookingFields';

export type Pick = BookingWho;

export function bookingLabels(t: T): BookingLabels {
  return {
    whoWith: t('whoWith'), once: t('bookOnce'), regular: t('bookRegular'), when: t('whenKyiv'), days: t('bookDays'),
    from: t('bookFrom'), count: t('bookCount'), preview: t('bookPreview'), left: t('bookLeft'), over: t('bookOver'),
    pickDay: t('bookPickDay'), duration: t('duration'), min: t('minShort'),
    whenIn: t('whenIn'), daysIn: t('daysIn'), tzNames: { 'Europe/Vienna': t('groupTime'), 'Europe/Kyiv': t('kyivTime') },
  };
}

// "Schedule a lesson": for teachers without a fixed timetable, a lesson is
// booked when it is agreed. Once, or regularly on several weekdays for as many
// lessons as the package has left. The school can also book trials and
// diagnostics, and lessons for an invited teacher who has not signed in yet.
export default function ScheduleLesson({
  t, locale, returnTo, students, groups = [], preselect, teacherId, pending, school, align = 'right', label,
}: {
  t: T; locale: Locale; returnTo: string; students: Pick[]; groups?: BookingGroup[]; preselect?: string;
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
        <BookingFields students={students} groups={groups} preselect={preselect} labels={bookingLabels(t)} locale={locale}
          kinds={school && students.length ? {
            label: t('lessonKind'),
            options: ['individual', 'trial', 'diagnostic'].map((k) => ({ value: k, label: t(`kind_${k}` as never) })),
          } : undefined} />
        <label>
          {t('zoomLink')}
          <input type="url" name="zoom_url" placeholder={t('zoomOptional')} />
        </label>
        <Submit className="primary">{t('scheduleSave')}</Submit>
        <small className="muted">{t(students.length ? 'scheduleHint' : 'scheduleHintGroup')}</small>
      </form>
    </details>
  );
}
