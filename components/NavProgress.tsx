'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// A thin red bar along the top from the moment a link (or back) is tapped
// until the next page is on screen, so a tap never looks ignored while the
// server prepares the page.
export default function NavProgress() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const busy = useRef(false);
  const safety = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const start = () => {
      busy.current = true;
      setState('busy');
      clearTimeout(safety.current);
      safety.current = setTimeout(() => { busy.current = false; setState('idle'); }, 30000);
    };
    // capture phase: Next's links cancel the browser's own navigation later on
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('popstate', start);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', start);
      clearTimeout(safety.current);
    };
  }, []);

  useEffect(() => {
    if (!busy.current) return;
    busy.current = false;
    clearTimeout(safety.current);
    setState('done');
    const t = setTimeout(() => setState('idle'), 400);
    return () => clearTimeout(t);
  }, [pathname, query]);

  if (state === 'idle') return null;
  return <div className={`nav-progress ${state}`} aria-hidden="true" />;
}
