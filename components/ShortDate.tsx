'use client';
import { useEffect, useState } from 'react';
import { hhmm, shortDay } from '@/lib/when';

// "чт 5.11" (and the time, if asked) in the viewer's own time zone.
export default function ShortDate({ iso, locale, time }: { iso: string; locale: string; time?: boolean }) {
  const make = (zone?: string) => `${shortDay(iso, locale, zone)}${time ? `, ${hhmm(iso, locale, zone)}` : ''}`;
  const [text, setText] = useState(() => make('Europe/Kyiv'));
  useEffect(() => { setText(make()); }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
