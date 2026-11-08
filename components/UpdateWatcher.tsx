'use client';
import { useEffect, useState } from 'react';

const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

async function serverVersion() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as { v: string }).v : MINE;
  } catch {
    return MINE;
  }
}

// Keeps an open LanHub window on the latest version: coming back to the app
// reloads it if a new version is out; while it stays open, a small bar offers
// to refresh (so nobody loses what they are typing).
export default function UpdateWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!MINE) return;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      if ((await serverVersion()) !== MINE) window.location.reload();
    };
    const tick = async () => {
      if (document.visibilityState === 'visible' && (await serverVersion()) !== MINE) setStale(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(tick, 3 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(id); };
  }, []);

  if (!stale) return null;
  // in the person's interface language; English when it is not known (sign-in page)
  const uk = document.documentElement.dataset.locale === 'uk';
  return (
    <div className="update-bar" role="status">
      <span>{uk ? 'Вийшла нова версія LanHub' : 'A new version of LanHub is out'}</span>
      <button type="button" className="primary small" onClick={() => window.location.reload()}>{uk ? 'Оновити' : 'Refresh'}</button>
    </div>
  );
}
