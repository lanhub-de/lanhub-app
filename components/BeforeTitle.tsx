'use client';
import { useEffect, useState } from 'react';
import { dayKey } from '@/lib/when';

// "For today's lesson" when the next lesson is today in the viewer's own time
// zone, otherwise "For the next lesson".
export default function BeforeTitle({ iso, today, next }: { iso: string | null; today: string; next: string }) {
  const pick = (zone?: string) => (iso && dayKey(iso, zone) === dayKey(new Date(), zone) ? today : next);
  const [text, setText] = useState(() => pick('Europe/Kyiv'));
  useEffect(() => { setText(pick()); }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span suppressHydrationWarning>{text}</span>;
}
