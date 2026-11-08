import { type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { currentMonthStart } from '@/lib/i18n';

type Line = {
  amount: number | string; currency: string;
  profiles: { full_name: string } | null;
  lessons: { starts_at: string; kind: string; status: string; students: { full_name: string } | null; groups: { name: string } | null } | null;
};

const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The month's teacher pay, one row per lesson, for Excel or Google Sheets.
// Database rules let only the owner read other teachers' pay.
export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'owner') return new Response('Owner only', { status: 403 });

  const m = request.nextUrl.searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}-01$/.test(m) ? m : currentMonthStart();
  const [{ data: lines }, { data: extra }] = await Promise.all([
    supabase.from('lesson_pay')
      .select('amount, currency, profiles!lesson_pay_teacher_id_fkey(full_name), lessons(starts_at, kind, status, students!lessons_student_id_fkey(full_name), groups!lessons_group_id_fkey(name))')
      .eq('month', month).returns<Line[]>(),
    supabase.from('payout_adjustments').select('description, amount, currency, profiles!payout_adjustments_teacher_id_fkey(full_name)').eq('month', month)
      .returns<{ description: string; amount: number | string; currency: string; profiles: { full_name: string } | null }[]>(),
  ]);

  const rows: unknown[][] = [['Teacher', 'Date (Kyiv)', 'Student or group', 'Kind', 'Status', 'Amount', 'Currency']];
  const kyiv = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
  for (const l of (lines ?? []).sort((a, b) =>
    String(a.profiles?.full_name).localeCompare(String(b.profiles?.full_name)) ||
    String(a.lessons?.starts_at).localeCompare(String(b.lessons?.starts_at)))) {
    rows.push([
      l.profiles?.full_name, l.lessons ? kyiv.format(new Date(l.lessons.starts_at)) : '',
      l.lessons?.students?.full_name ?? l.lessons?.groups?.name ?? '', l.lessons?.kind, l.lessons?.status,
      l.amount, l.currency,
    ]);
  }
  for (const a of extra ?? []) rows.push([a.profiles?.full_name, '', a.description, 'extra', '', a.amount, a.currency]);

  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="lanhub-payouts-${month.slice(0, 7)}.csv"`,
    },
  });
}
