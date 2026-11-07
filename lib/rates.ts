import type { T } from './i18n';

export type RateRow = {
  teacher_id: string; kind: string; band: string | null; market: string | null;
  package_lessons: number | null; student_id: string | null; group_id: string | null;
  amount: number | string; valid_from: string;
};

// A short line for the payouts table: "450 / 520" or "400 / 420–460".
// Only the general individual rates count; special ones stay on the Team page.
export function rateSummary(rows: RateRow[], t: T, today = new Date().toISOString().slice(0, 10)) {
  const current = new Map<string, RateRow>();
  for (const r of rows) {
    if (r.valid_from > today) continue;
    const key = [r.kind, r.band, r.market, r.package_lessons, r.student_id, r.group_id].join('|');
    const prev = current.get(key);
    if (!prev || prev.valid_from < r.valid_from) current.set(key, r);
  }
  const general = [...current.values()].filter((r) => r.kind === 'individual' && !r.market && !r.student_id && !r.group_id);
  const a = general.filter((r) => r.band === 'A' || r.band === null).map((r) => Number(r.amount));
  const b = general.filter((r) => r.band === 'B').map((r) => Number(r.amount));
  const span = (xs: number[]) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  if (a.length && b.length) return `${span(a)} / ${span(b)}`;
  if (a.length) return span(a);
  if (b.length) return span(b);
  if (current.size) return t('groupsClub');
  return '—';
}
