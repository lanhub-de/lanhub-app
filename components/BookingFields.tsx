'use client';
import { useMemo, useState } from 'react';

export type BookingLabels = {
  whoWith: string; once: string; regular: string; when: string; days: string; from: string; count: string;
  preview: string; left: string; over: string; pickDay: string; duration: string; min: string;
  whenIn: string; daysIn: string; tzNames: Record<string, string>;
};
export type BookingWho = { id: string; name: string; level?: string | null; left?: number | null };
// A group brings its own clock and, if it has a timetable, its usual days, time and lesson length.
export type BookingGroup = { id: string; name: string; tz?: string | null; days?: number[] | null; time?: string | null; minutes?: number | null };
export type BookingKinds = { label: string; options: { value: string; label: string }[] };

const MAX = 24;
const LENGTHS = [45, 60, 90, 120];
type Day = { time: string; min: number };
// Monday first; the weekday number as in Date.getUTCDay()
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function todayKyiv() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// The lessons to book, as Kyiv wall-clock times with their length
// ("2026-11-18T18:00|90"): the chosen weekdays from the start date on, each at
// its own time and length (Tue 60 min, Thu 90 min), until there are as many as asked.
export function slotsFor(days: Record<number, Day>, from: string, count: number) {
  const chosen = Object.keys(days).map(Number);
  if (!chosen.length || !from || count < 1) return [];
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < 400 && out.length < count; i++) {
    const wd = d.getUTCDay();
    const day = days[wd];
    if (chosen.includes(wd) && day?.time) out.push(`${d.toISOString().slice(0, 10)}T${day.time}|${day.min}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// The group's usual weekdays (ISO, Monday = 1) as day chips at its usual time.
function groupDays(g: BookingGroup | null | undefined): Record<number, Day> {
  const out: Record<number, Day> = {};
  const time = (g?.time ?? '').slice(0, 5);
  if (!g || !time) return out;
  for (const d of g.days ?? []) out[d === 7 ? 0 : d] = { time, min: g.minutes ?? 90 };
  return out;
}

// "Who with" plus when: once, or regularly on several weekdays (each with its
// own time) for as many lessons as the package has left. The dates to be
// booked are listed before saving. A group is booked on its own clock (Vienna
// for the international flows), 90 minutes by default, on its usual days.
export default function BookingFields({ students, groups = [], preselect, labels, locale, kinds }: {
  students: BookingWho[]; groups?: BookingGroup[]; preselect?: string;
  labels: BookingLabels; locale: 'uk' | 'en'; kinds?: BookingKinds;
}) {
  const groupOf = (value: string) => (value.startsWith('g:') ? groups.find((g) => `g:${g.id}` === value) ?? null : null);
  const [who, setWho] = useState(preselect ?? '');
  const group = groupOf(who);
  const [mode, setMode] = useState<'once' | 'regular'>('once');
  const [days, setDays] = useState<Record<number, Day>>(() => groupDays(groupOf(preselect ?? '')));
  const [from, setFrom] = useState(todayKyiv);
  const left = who.startsWith('s:') ? students.find((s) => `s:${s.id}` === who)?.left ?? null : null;
  const [count, setCount] = useState<number>(groupOf(preselect ?? '') ? 8 : left && left > 0 ? Math.max(1, Math.floor(left)) : 4);
  const [touched, setTouched] = useState(false);
  const [onceMin, setOnceMin] = useState<number>(groupOf(preselect ?? '') ? groupOf(preselect ?? '')?.minutes ?? 90 : 60);
  // which clock the times are on
  const tz = group?.tz && group.tz !== 'Europe/Kyiv' ? group.tz : null;
  const whenLabel = tz ? labels.whenIn.replace('{tz}', labels.tzNames[tz] ?? tz) : labels.when;

  const loc = locale === 'uk' ? 'uk-UA' : 'en-GB';
  const dayName = (wd: number) => new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 10, 15 + (wd === 0 ? 7 : wd)))); // 16 Nov 2026 is a Monday
  const slots = useMemo(() => slotsFor(days, from, Math.min(MAX, Math.max(1, count || 1))), [days, from, count]);
  // a package counts hours: 90 minutes use 1.5
  const units = slots.reduce((n, s) => n + Number(s.split('|')[1] || 60) / 60, 0);
  const fmt = (s: string) => {
    const [when, min] = s.split('|');
    const [d, time] = when.split('T');
    const date = new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${d}T12:00:00Z`));
    return `${date} ${time} · ${min} ${labels.min}`;
  };

  const toggle = (wd: number) => setDays((cur) => {
    const next = { ...cur };
    if (next[wd]) delete next[wd];
    else next[wd] = Object.values(cur).at(-1) ?? { time: (group?.time ?? '').slice(0, 5) || '18:00', min: group ? group.minutes ?? 90 : 60 };
    return next;
  });

  const pick = (value: string) => {
    setWho(value);
    const g = groupOf(value);
    if (g) {
      setOnceMin(g.minutes ?? 90);
      if (!touched) setCount(8);
      const usual = groupDays(g);
      if (Object.keys(usual).length) setDays(usual);
      return;
    }
    setOnceMin(60);
    const l = students.find((s) => `s:${s.id}` === value)?.left;
    if (!touched) setCount(l && l > 0 ? Math.max(1, Math.floor(l)) : 4);
  };

  return (
    <>
      <label>
        {labels.whoWith}
        <select name="who" required value={who} onChange={(e) => pick(e.target.value)}>
          <option value="" disabled>…</option>
          {students.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}{s.level ? ` · ${s.level}` : ''}</option>)}
          {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
        </select>
      </label>
      {tz && <input type="hidden" name="tz" value={tz} />}
      {kinds && !group && (
        <label>
          {kinds.label}
          <select name="kind" defaultValue={kinds.options[0]?.value}>
            {kinds.options.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
      )}

      <div className="seg" role="group">
        <button type="button" className={mode === 'once' ? 'on' : ''} aria-pressed={mode === 'once'} onClick={() => setMode('once')}>{labels.once}</button>
        <button type="button" className={mode === 'regular' ? 'on' : ''} aria-pressed={mode === 'regular'} onClick={() => setMode('regular')}>{labels.regular}</button>
      </div>

      {mode === 'once' ? (
        <div className="schedule-two">
          <label>{whenLabel}<input type="datetime-local" name="slot" required /></label>
          <label>
            {labels.duration}
            <select name="duration_min" value={onceMin} onChange={(e) => setOnceMin(Number(e.target.value))}>
              {LENGTHS.map((m) => <option key={m} value={m}>{m} {labels.min}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <>
          <div className="book-days">
            <span className="book-label">{tz ? labels.daysIn.replace('{tz}', labels.tzNames[tz] ?? tz) : labels.days}</span>
            <div className="day-chips">
              {WEEK.map((wd) => (
                <button key={wd} type="button" className={days[wd] ? 'on' : ''} aria-pressed={Boolean(days[wd])} onClick={() => toggle(wd)}>
                  {dayName(wd)}
                </button>
              ))}
            </div>
            {WEEK.filter((wd) => days[wd]).map((wd) => (
              <div key={wd} className="day-time">
                <span>{dayName(wd)}</span>
                <input type="time" step={300} value={days[wd].time} required aria-label={`${dayName(wd)} · ${labels.when}`}
                  onChange={(e) => setDays((cur) => ({ ...cur, [wd]: { ...cur[wd], time: e.target.value } }))} />
                <select value={days[wd].min} aria-label={`${dayName(wd)} · ${labels.duration}`}
                  onChange={(e) => setDays((cur) => ({ ...cur, [wd]: { ...cur[wd], min: Number(e.target.value) } }))}>
                  {LENGTHS.map((m) => <option key={m} value={m}>{m} {labels.min}</option>)}
                </select>
              </div>
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
            <small className={units > left ? 'book-warn' : 'muted'}>
              {(units > left ? labels.over : labels.left).replace('{n}', String(left))}
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
