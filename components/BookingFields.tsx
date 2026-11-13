'use client';
import { useMemo, useState } from 'react';

export type BookingLabels = {
  whoWith: string; once: string; regular: string; when: string; days: string; from: string; count: string;
  preview: string; left: string; over: string; pickDay: string;
};
export type BookingWho = { id: string; name: string; level?: string | null; left?: number | null };

const MAX = 24;
// Monday first; the weekday number as in Date.getUTCDay()
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function todayKyiv() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// The lessons to book, as Kyiv wall-clock times ("2026-11-18T18:00"): the
// chosen weekdays from the start date on, each at its own time, until there
// are as many as asked.
export function slotsFor(days: Record<number, string>, from: string, count: number) {
  const chosen = Object.keys(days).map(Number);
  if (!chosen.length || !from || count < 1) return [];
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < 400 && out.length < count; i++) {
    const wd = d.getUTCDay();
    if (chosen.includes(wd) && days[wd]) out.push(`${d.toISOString().slice(0, 10)}T${days[wd]}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// "Who with" plus when: once, or regularly on several weekdays (each with its
// own time) for as many lessons as the package has left. The dates to be
// booked are listed before saving.
export default function BookingFields({ students, groups = [], preselect, labels, locale }: {
  students: BookingWho[]; groups?: { id: string; name: string }[]; preselect?: string;
  labels: BookingLabels; locale: 'uk' | 'en';
}) {
  const [who, setWho] = useState(preselect ?? '');
  const [mode, setMode] = useState<'once' | 'regular'>('once');
  const [days, setDays] = useState<Record<number, string>>({});
  const [from, setFrom] = useState(todayKyiv);
  const left = who.startsWith('s:') ? students.find((s) => `s:${s.id}` === who)?.left ?? null : null;
  const [count, setCount] = useState<number>(left && left > 0 ? left : 4);
  const [touched, setTouched] = useState(false);

  const loc = locale === 'uk' ? 'uk-UA' : 'en-GB';
  const dayName = (wd: number) => new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 10, 15 + (wd === 0 ? 7 : wd)))); // 16 Nov 2026 is a Monday
  const slots = useMemo(() => slotsFor(days, from, Math.min(MAX, Math.max(1, count || 1))), [days, from, count]);
  const fmt = (s: string) => {
    const [d, time] = s.split('T');
    const date = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${d}T12:00:00Z`));
    return `${date} ${time}`;
  };

  const toggle = (wd: number) => setDays((cur) => {
    const next = { ...cur };
    if (next[wd]) delete next[wd];
    else next[wd] = Object.values(cur).at(-1) ?? '18:00';
    return next;
  });

  return (
    <>
      <label>
        {labels.whoWith}
        <select name="who" required value={who} onChange={(e) => {
          setWho(e.target.value);
          const l = e.target.value.startsWith('s:') ? students.find((s) => `s:${s.id}` === e.target.value)?.left : null;
          if (!touched) setCount(l && l > 0 ? l : 4);
        }}>
          <option value="" disabled>…</option>
          {students.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}{s.level ? ` · ${s.level}` : ''}</option>)}
          {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
        </select>
      </label>

      <div className="seg" role="group">
        <button type="button" className={mode === 'once' ? 'on' : ''} aria-pressed={mode === 'once'} onClick={() => setMode('once')}>{labels.once}</button>
        <button type="button" className={mode === 'regular' ? 'on' : ''} aria-pressed={mode === 'regular'} onClick={() => setMode('regular')}>{labels.regular}</button>
      </div>

      {mode === 'once' ? (
        <label>{labels.when}<input type="datetime-local" name="slot" required /></label>
      ) : (
        <>
          <div className="book-days">
            <span className="book-label">{labels.days}</span>
            <div className="day-chips">
              {WEEK.map((wd) => (
                <button key={wd} type="button" className={days[wd] ? 'on' : ''} aria-pressed={Boolean(days[wd])} onClick={() => toggle(wd)}>
                  {dayName(wd)}
                </button>
              ))}
            </div>
            {WEEK.filter((wd) => days[wd]).map((wd) => (
              <label key={wd} className="day-time">
                <span>{dayName(wd)}</span>
                <input type="time" step={300} value={days[wd]} required
                  onChange={(e) => setDays((cur) => ({ ...cur, [wd]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="schedule-two">
            <label>{labels.from}<input type="date" value={from} required onChange={(e) => setFrom(e.target.value)} /></label>
            <label>
              {labels.count}
              <input type="number" min={1} max={MAX} value={count} required
                onChange={(e) => { setTouched(true); setCount(Number(e.target.value)); }} />
            </label>
          </div>
          {left != null && (
            <small className={count > left ? 'book-warn' : 'muted'}>
              {(count > left ? labels.over : labels.left).replace('{n}', String(left))}
            </small>
          )}
          {slots.length ? (
            <div className="book-preview">
              <span className="book-label">{labels.preview} ({slots.length})</span>
              <ul>{slots.map((s) => <li key={s}>{fmt(s)}</li>)}</ul>
            </div>
          ) : (
            <small className="muted">{labels.pickDay}</small>
          )}
          {slots.map((s) => <input key={s} type="hidden" name="slot" value={s} />)}
        </>
      )}
    </>
  );
}
