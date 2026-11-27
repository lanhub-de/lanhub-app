import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { SCHOOL_TZ } from '@/lib/i18n';
import { TASK_COLOR, twoWeeks, type CalEvent } from '@/lib/manager';

const KINDS = ['last', 'feedback', 'payment', 'ends', 'diagnostic'] as const;

// Two weeks from this Monday: a dot on the day of a last lesson, the middle
// of a package, the last paid lesson, a package's month ending, a diagnostic.
// Under it, the coming week as a list.
export default function TaskCalendar({ events, t, locale }: { events: CalEvent[]; t: T; locale: Locale }) {
  const { today, days } = twoWeeks();
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 10, 23 + i))));
  const soon = days.filter((d) => d >= today).slice(0, 7);
  const dayLabel = (d: string) => new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${d}T12:00:00Z`));
  const time = (iso: string) => new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TZ }).format(new Date(iso));
  const fmtRange = `${dayLabel(days[0]).replace(/^\S+\s/, '')} – ${dayLabel(days[13]).replace(/^\S+\s/, '')}`;

  return (
    <section className="card" aria-labelledby="cal-h">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 id="cal-h" style={{ margin: 0 }}>{t('calendar')}</h2>
        <span className="muted" style={{ fontSize: 13 }}>{fmtRange}</span>
      </div>
      <div className="cal" aria-hidden="true">
        {weekdays.map((w) => <span key={w} className="cal-h">{w}</span>)}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const kinds = KINDS.filter((k) => list.some((e) => e.kind === k));
          return (
            <div key={d} className={`cal-d ${d === today ? 'today' : d < today ? 'past' : ''}`}>
              {Number(d.slice(8))}
              <div className="cal-dots">{kinds.map((k) => <span key={k} style={{ background: TASK_COLOR[k] }} />)}</div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {KINDS.map((k) => <span key={k}><i style={{ background: TASK_COLOR[k] }} />{t(`cal_${k}` as never)}</span>)}
      </div>
      <h3 className="cal-soon-h">{t('calSoon')}</h3>
      {soon.every((d) => !(byDay.get(d) ?? []).length) && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('nothingHere')}</p>}
      <div className="cal-soon">
        {soon.filter((d) => (byDay.get(d) ?? []).length).map((d) => (
          <div key={d}>
            <div className="cal-soon-day">{d === today ? t('today') : dayLabel(d)}</div>
            {(byDay.get(d) ?? []).sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => (
              <Link key={i} href={`/school/students/${e.student.id}`} className="cal-soon-row">
                <i style={{ background: TASK_COLOR[e.kind] }} aria-hidden="true" />
                <span>{e.kind !== 'ends' ? `${time(e.at)} · ` : ''}{e.student.full_name}</span>
                <span className="muted">{t(`cal_${e.kind}` as never)}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
