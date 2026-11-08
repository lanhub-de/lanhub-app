'use client';
import { useEffect, useState } from 'react';

// A date and time in the viewer's own time zone (the server only knows Kyiv
// time, so it shows that until the browser takes over).
export default function LocalTime({ iso, locale, fallbackTz = 'Europe/Kyiv' }: { iso: string; locale: string; fallbackTz?: string }) {
  const fmt = (tz?: string) => new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
  const [text, setText] = useState(() => fmt(fallbackTz));
  useEffect(() => { setText(fmt()); }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
