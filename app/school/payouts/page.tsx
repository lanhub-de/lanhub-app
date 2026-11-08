import Shell, { Flash } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import { currentMonthStart, fmtDateTime, fmtMoney, fmtMonth } from '@/lib/i18n';
import { syncAllowances } from '@/lib/allowances';
import { addAdjustment, setPayoutStatus } from '../actions';

type PayLine = {
  amount: number; currency: string; teacher_id: string;
  lessons: { starts_at: string; kind: string; status: string; students: { full_name: string; level: string | null } | null; groups: { name: string } | null } | null;
};

export default async function PayoutsPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; month?: string; open?: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner']);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? '') ? sp.month! : currentMonthStart();
  await syncAllowances(supabase, month);

  const [summary, lines, adjustments, teachers] = await Promise.all([
    supabase.from('monthly_payouts').select('teacher_id, teacher_name, total, lessons_count, review_status, currency').eq('month', month).order('teacher_name'),
    supabase.from('lesson_pay')
      .select('amount, currency, teacher_id, lessons(starts_at, kind, status, students(full_name, level), groups(name))')
      .eq('month', month).returns<PayLine[]>(),
    supabase.from('payout_adjustments').select('teacher_id, description, amount, currency').eq('month', month),
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher', 'owner']).order('full_name'),
  ]);

  const total = (summary.data ?? []).reduce((s, r) => s + Number(r.total), 0);
  const months: string[] = [];
  const cur = new Date(currentMonthStart() + 'T00:00:00Z');
  for (let i = -1; i < 12; i++) months.push(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1)).toISOString().slice(0, 10));

  return (
    <Shell profile={profile} t={t} active="/school/payouts">
      <h1>{t('payouts')}</h1>
      <Flash error={sp.e} />
      <form className="row" style={{ marginBottom: 16 }}>
        <select name="month" defaultValue={month} aria-label={t('month')}>
          {months.map((m) => <option key={m} value={m}>{fmtMonth(m, profile.locale)}</option>)}
        </select>
        <button type="submit">OK</button>
        <a href={`/school/payouts/export?month=${month}`} className="btn">{t('exportCsv')}</a>
      </form>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="muted">{t('payoutsMonth', { month: fmtMonth(month, profile.locale) })}</div>
        <div className="big">{fmtMoney(total)}</div>
      </div>

      <div className="stack">
        {(summary.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
        {(summary.data ?? []).map((r) => {
          const mine = (lines.data ?? []).filter((l) => l.teacher_id === r.teacher_id)
            .sort((a, b) => String(a.lessons?.starts_at).localeCompare(String(b.lessons?.starts_at)));
          const extra = (adjustments.data ?? []).filter((a) => a.teacher_id === r.teacher_id);
          return (
            <details key={r.teacher_id} className="card" open={sp.open === r.teacher_id}>
              <summary className="spread" style={{ color: 'var(--ink)' }}>
                <span style={{ fontWeight: 600 }}>{r.teacher_name}</span>
                <span className="row">
                  <span className="muted">{r.lessons_count} {t('lessonsCount')}</span>
                  <strong>{fmtMoney(r.total, r.currency)}</strong>
                  <span className={`pill ${r.review_status === 'paid' ? 'ok' : ''}`}>{t(`review_${r.review_status}` as never)}</span>
                </span>
              </summary>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <tbody>
                    {mine.map((l, i) => (
                      <tr key={i}>
                        <td>{l.lessons ? fmtDateTime(l.lessons.starts_at, profile.locale) : ''}</td>
                        <td>{l.lessons?.students?.full_name ?? l.lessons?.groups?.name ?? ''}{l.lessons?.students?.level ? ` · ${l.lessons.students.level}` : ''}</td>
                        <td className="muted">{l.lessons ? `${t(`kind_${l.lessons.kind}` as never)} · ${t(`st_${l.lessons.status}` as never)}` : ''}</td>
                        <td className="num">{fmtMoney(l.amount, l.currency)}</td>
                      </tr>
                    ))}
                    {extra.map((a, i) => (
                      <tr key={`x${i}`}>
                        <td colSpan={3}>{a.description}</td>
                        <td className="num">{fmtMoney(a.amount, a.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {(['checked', 'paid'] as const).map((st) => (
                  <form key={st} action={setPayoutStatus}>
                    <input type="hidden" name="teacher_id" value={r.teacher_id} />
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="status" value={st} />
                    <button className={st === 'paid' ? 'primary small' : 'small'} type="submit">
                      {t(st === 'paid' ? 'markPaid' : 'markChecked')}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <details className="card" style={{ marginTop: 16 }}>
        <summary>+ {t('extraLine')}</summary>
        <form action={addAdjustment} className="form" style={{ marginTop: 12 }}>
          <input type="hidden" name="month" value={month} />
          <label>{t('teacher')}
            <select name="teacher_id" required defaultValue="">
              <option value="" disabled>…</option>
              {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label>{t('description')}<input name="description" required placeholder="Zoom" /></label>
          <label>{t('amount')}<input name="amount" type="number" step="0.01" required /></label>
          <button className="primary" type="submit">{t('add')}</button>
        </form>
      </details>
    </Shell>
  );
}
