import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtMoney, fmtMonth } from '@/lib/i18n';
import { addAllowance, addRate, endAllowance, invitePerson, resendInvite, setActive } from '../actions';

type Rate = {
  id: string; teacher_id: string; kind: string; band: string | null; market: string | null;
  package_lessons: number | null; amount: number; currency: string; valid_from: string;
  students: { full_name: string } | null; groups: { name: string } | null;
  rate_steps: { min_present: number; amount: number }[];
};
type Allowance = { id: string; teacher_id: string; label: string; amount: number; currency: string; starts_on: string; ends_on: string | null };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner']);
  const sp = await searchParams;
  const [people, invites, rates, allowances] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role, active, viewer_code').order('full_name'),
    supabase.from('invites').select('email, full_name, role, created_at').is('accepted_at', null).order('created_at'),
    supabase.from('teacher_rates').select('*, students(full_name), groups(name), rate_steps(min_present, amount)').order('valid_from', { ascending: false }).returns<Rate[]>(),
    supabase.from('teacher_allowances').select('*').order('starts_on').returns<Allowance[]>(),
  ]);
  const thisMonth = currentMonthStart();
  const teaching = (people.data ?? []).filter((p) => ['teacher', 'head_teacher', 'owner'].includes(p.role));
  const others = (people.data ?? []).filter((p) => !['teacher', 'head_teacher', 'owner'].includes(p.role));

  const describe = (r: Rate) => [
    t(`kind_${r.kind}` as never),
    r.band ? t(r.band === 'A' ? 'bandA' : 'bandB') : null,
    r.market === 'intl' ? t('market_intl') : null,
    r.package_lessons ? t('packageOf', { n: r.package_lessons }) : null,
    r.students?.full_name ?? r.groups?.name ?? null,
  ].filter(Boolean).join(' · ');

  return (
    <Shell profile={profile} t={t} active="/school/team">
      <h1>{t('team')}</h1>
      <Flash error={sp.e} ok={sp.ok === 'sent' ? t('inviteSent') : undefined} />

      <details className="card" style={{ marginBottom: 16 }} open={(people.data ?? []).length <= 1}>
        <summary>+ {t('invite')}</summary>
        <p className="muted">{t('inviteHint')}</p>
        <form action={invitePerson} className="form">
          <label>{t('name')}<input name="full_name" required /></label>
          <label>{t('emailLabel')}<input type="email" name="email" required /></label>
          <label>{t('status')}
            <select name="role" defaultValue="teacher">
              {(['teacher', 'head_teacher', 'manager', 'owner'] as const).map((r) => <option key={r} value={r}>{t(`role_${r}`)}</option>)}
            </select>
          </label>
          <label>{t('ratesTemplate')}
            <select name="template" defaultValue="400">
              <option value="400">{t('tpl_400')}</option>
              <option value="450">{t('tpl_450')}</option>
              <option value="550">{t('tpl_550')}</option>
              <option value="">{t('tpl_none')}</option>
            </select>
          </label>
          <label>{t('language')}
            <select name="locale" defaultValue="en"><option value="en">English</option><option value="uk">Українська</option></select>
          </label>
          <button className="primary" type="submit">{t('invite')}</button>
        </form>
      </details>

      {(invites.data ?? []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          {(invites.data ?? []).map((i) => (
            <div key={i.email} className="spread" style={{ padding: '6px 0' }}>
              <span>{i.full_name} <span className="muted">· {i.email} · {t(`role_${i.role}` as never)}</span></span>
              <span className="row">
                <span className="pill">{t('pending')}</span>
                {['teacher', 'head_teacher'].includes(i.role) && (
                  <Link href={`/teacher?as=${encodeURIComponent(`invite:${i.email}`)}`} className="btn small">{t('openCabinet')}</Link>
                )}
                <form action={resendInvite}>
                  <input type="hidden" name="email" value={i.email} />
                  <button className="small" type="submit">{t('sendInvite')}</button>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="stack">
        {teaching.map((p) => {
          const mine = (rates.data ?? []).filter((r) => r.teacher_id === p.id);
          return (
            <details key={p.id} className="card">
              <summary className="spread" style={{ color: 'var(--ink)' }}>
                <span style={{ fontWeight: 600 }}>{p.full_name} <span className="muted">· {t(`role_${p.role}` as never)} · {p.viewer_code}</span></span>
                <span className="muted">{p.email}{!p.active ? ' · off' : ''}</span>
              </summary>
              {p.id !== profile.id && (
                <p style={{ margin: '12px 0 0' }}><Link href={`/teacher?as=${p.id}`} className="btn small">{t('openCabinet')}</Link></p>
              )}
              <h2 style={{ marginTop: 12 }}>{t('rates')}</h2>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {describe(r)}
                          {r.rate_steps.length > 0 && (
                            <div className="muted" style={{ fontSize: 13 }}>
                              {[...r.rate_steps].sort((a, b) => a.min_present - b.min_present)
                                .map((s) => `${t('fromPresent', { n: s.min_present })}: ${fmtMoney(s.amount, r.currency)}`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="muted">{t('validFrom')} {fmtDate(r.valid_from, profile.locale)}</td>
                        <td className="num">{fmtMoney(r.amount, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={addRate} className="form" style={{ marginTop: 12 }}>
                <input type="hidden" name="teacher_id" value={p.id} />
                <label>{t('status')}
                  <select name="kind" defaultValue="individual">
                    {['individual', 'pair', 'group', 'club', 'trial', 'diagnostic'].map((k) => <option key={k} value={k}>{t(`kind_${k}` as never)}</option>)}
                  </select>
                </label>
                <label>{t('level')}
                  <select name="band" defaultValue=""><option value="">{t('anyLevel')}</option><option value="A">{t('bandA')}</option><option value="B">{t('bandB')}</option></select>
                </label>
                <label>{t('market')}
                  <select name="market" defaultValue=""><option value="">…</option><option value="ua">{t('market_ua')}</option><option value="intl">{t('market_intl')}</option></select>
                </label>
                <label>{t('lessonsTotal')}
                  <select name="package_lessons" defaultValue=""><option value="">{t('anyPackage')}</option>{[8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                </label>
                <label>{t('amount')}<input name="amount" type="number" step="0.01" required /></label>
                <label>{t('rateSteps')}<input name="steps" placeholder={t('rateStepsHint')} /></label>
                <label>{t('validFrom')}<input name="valid_from" type="date" /></label>
                <button type="submit">{t('addRate')}</button>
              </form>

              <h2 style={{ marginTop: 20 }}>{t('allowances')}</h2>
              <p className="muted" style={{ marginTop: 0 }}>{t('allowanceHint')}</p>
              {(allowances.data ?? []).filter((a) => a.teacher_id === p.id && (!a.ends_on || a.ends_on >= thisMonth)).map((a) => (
                <div key={a.id} className="spread" style={{ padding: '6px 0' }}>
                  <span>
                    <strong>{a.label}</strong> · {fmtMoney(a.amount, a.currency)} {t('perMonth')}
                    <span className="muted"> · {t('validFrom')} {fmtMonth(a.starts_on, profile.locale)}{a.ends_on ? ` · ${t('untilMonth', { month: fmtMonth(a.ends_on, profile.locale) })}` : ''}</span>
                  </span>
                  {!a.ends_on && (
                    <form action={endAllowance}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="small" type="submit">{t('stopAllowance')}</button>
                    </form>
                  )}
                </div>
              ))}
              <form action={addAllowance} className="form" style={{ marginTop: 8 }}>
                <input type="hidden" name="teacher_id" value={p.id} />
                <label>{t('name')}<input name="label" defaultValue="Zoom" required /></label>
                <label>{t('amount')}<input name="amount" type="number" step="0.01" required /></label>
                <label>€ / грн
                  <select name="currency" defaultValue="UAH"><option value="UAH">UAH</option><option value="EUR">EUR</option><option value="USD">USD</option></select>
                </label>
                <label>{t('fromMonth')}<input name="starts_on" type="month" defaultValue={thisMonth.slice(0, 7)} /></label>
                <button type="submit">{t('addAllowance')}</button>
              </form>
              {p.id !== profile.id && (
                <form action={setActive} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                  <button className="small" type="submit">{p.active ? '⏸ off' : '▶ on'}</button>
                </form>
              )}
            </details>
          );
        })}
        {others.map((p) => (
          <div key={p.id} className="card spread">
            <span>{p.full_name} <span className="muted">· {t(`role_${p.role}` as never)}</span></span>
            <span className="row">
              <span className="muted">{p.email}</span>
              <form action={setActive}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                <button className="small" type="submit">{p.active ? '⏸ off' : '▶ on'}</button>
              </form>
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
