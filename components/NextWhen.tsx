'use client';
import { useEffect, useState } from 'react';
import { dayKey, hhmm, shortDay } from '@/lib/when';

// "Сьогодні, 16:00" / "Завтра, 16:00" / "пт 13.11, 16:00" in the viewer's own
// time zone (Kyiv until the browser takes over), or always in tz if given.
export default function NextWhen({ iso, locale, today, tomorrow, tz }: {
  iso: string; locale: string; today: string; tomorrow: string; tz?: string;
}) {
  const make = (zone?: string) => {
    const now = new Date();
    const d = dayKey(iso, zone);
    const day = d === dayKey(now, zone) ? today
      : d === dayKey(new Date(now.getTime() + 864e5), zone) ? tomorrow : shortDay(iso, locale, zone);
    return `${day}, ${hhmm(iso, locale, zone)}`;
  };
  const [text, setText] = useState(() => make(tz ?? 'Europe/Kyiv'));
  useEffect(() => { setText(make(tz)); }, [iso, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
