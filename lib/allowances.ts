import type { SupabaseClient } from '@supabase/supabase-js';
import { currentMonthStart } from './i18n';

type Allowance = {
  id: string; teacher_id: string; label: string; amount: number | string; currency: string;
  starts_on: string; ends_on: string | null;
};

const SYMBOL: Record<string, string> = { EUR: '€', USD: '$' };

// Official NBU rate for a day (yyyy-mm-dd). Null when the bank cannot be reached.
async function nbuRate(currency: string, day: string): Promise<{ rate: number; date: string } | null> {
  try {
    const res = await fetch(
      `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&date=${day.replaceAll('-', '')}&json`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const [row] = (await res.json()) as { rate: number; exchangedate: string }[];
    return row?.rate ? { rate: row.rate, date: row.exchangedate } : null;
  } catch {
    return null;
  }
}

// Writes the month's line for every monthly extra (Zoom and the like) that
// does not have one yet. Euros are converted at the NBU rate of the month's
// last day, or of today for the month in progress. Only the owner can write
// payout lines, so only her pages call this. Deleting a line brings it back
// on the next visit at a fresh rate; to stop an extra, end it on the Team page.
export async function syncAllowances(supabase: SupabaseClient, month: string) {
  if (month > currentMonthStart()) return;
  const { data } = await supabase.from('teacher_allowances')
    .select('id, teacher_id, label, amount, currency, starts_on, ends_on')
    .lte('starts_on', month);
  const due = ((data ?? []) as Allowance[]).filter((a) => !a.ends_on || a.ends_on >= month);
  if (!due.length) return;

  const { data: have } = await supabase.from('payout_adjustments').select('allowance_id')
    .eq('month', month).in('allowance_id', due.map((a) => a.id));
  const taken = new Set((have ?? []).map((h) => h.allowance_id as string));
  const missing = due.filter((a) => !taken.has(a.id));
  if (!missing.length) return;

  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const day = lastDay < today ? lastDay : today;

  const rows = [];
  for (const a of missing) {
    const amount = Number(a.amount);
    if (a.currency === 'UAH') {
      rows.push({ teacher_id: a.teacher_id, month, description: a.label, amount, currency: 'UAH', allowance_id: a.id });
      continue;
    }
    const fx = await nbuRate(a.currency, day);
    if (!fx) continue;
    rows.push({
      teacher_id: a.teacher_id,
      month,
      description: `${a.label} · ${amount} ${SYMBOL[a.currency] ?? a.currency} × ${fx.rate.toFixed(2)} (NBU ${fx.date})`,
      amount: Math.round(amount * fx.rate * 100) / 100,
      currency: 'UAH',
      allowance_id: a.id,
    });
  }
  // A second tab may have written the same line a moment ago; the unique
  // index keeps one, and the error is harmless.
  for (const r of rows) await supabase.from('payout_adjustments').insert(r);
}
