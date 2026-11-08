'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// The installed app has no browser back button, so the top bar carries one.
// It goes back through the pages opened in this session, step by step; on a
// page opened straight from a link it leads home instead.
const KEY = 'lh-nav';
const HOMES = ['/', '/teacher', '/school', '/me'];
type State = { depth: number; last: string; pop: boolean };

function read(): State {
  try { return { depth: 0, last: '', pop: false, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return { depth: 0, last: '', pop: false }; }
}
function write(s: State) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: the button still leads home */ }
}

export default function BackButton({ label }: { label: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [depth, setDepth] = useState(0);
  const query = search.toString();

  useEffect(() => {
    const url = pathname + (query ? `?${query}` : '');
    let s = read();
    if (!s.last) s = { depth: 0, last: url, pop: false };
    else if (s.last !== url) s = { depth: s.pop ? Math.max(0, s.depth - 1) : s.depth + 1, last: url, pop: false };
    write(s);
    setDepth(s.depth);
  }, [pathname, query]);

  useEffect(() => {
    // back (this button, the phone's back gesture) arrives as popstate
    const onPop = () => write({ ...read(), pop: true });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (depth === 0 && HOMES.includes(pathname)) return null;
  return (
    <button type="button" className="back-btn" aria-label={label} title={label}
      onClick={() => (depth > 0 ? router.back() : router.push('/'))}>
      <span aria-hidden="true">←</span><span className="back-label">{label}</span>
    </button>
  );
}
