import Link from 'next/link';
import Shell from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtDateTime, fmtMoney, fmtMonth } from '@/lib/i18n';
import { LESSON_SELECT, type LessonDb } from '@/lib/lessons';
import { rateSummary, type RateRow } from '@/lib/rates';
import { syncAllowances } from '@/lib/allowances';
import { INVITE, pendingTeachers } from '@/lib/invites';

type PayoutRow = { teacher_id: string; teacher_name: string; total: number | string; lessons_count: number; review_status: string; currency: string };
type Person = { id: string; full_name: string; role: string; active: boolean };

export default async function SchoolOverview() {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const month = currentMonthStart();
  const isOwner = profile.role === 'owner';
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  if (isOwner) await syncAllowances(supabase, month);

  const [notRenewed, unmarked, payouts, people, rates, invited] = await Promise.all([
    supabase.from('students_not_renewed').select('student_id, full_name, level, teacher_id, last_valid_until')
      .order('last_valid_until', { ascending: false }),
    supabase.from('lessons').select(LESSON_SELECT).eq('status', 'scheduled').lt('starts_at', dayAgo)
      .order('starts_at').limit(30).returns<LessonDb[]>(),
    isOwner
      ? supabase.from('monthly_payouts').select('teacher_id, teacher_name, total, lessons_count, review_status, currency').eq('month', month).returns<PayoutRow[]>()
      : Promise.resolve({ data: null as PayoutRow[] | null }),
    supabase.from('profiles').select('id, full_name, role, active').returns<Person[]>(),
    isOwner
      ? supabase.from('teacher_rates').select('teacher_id, kind, band, market, package_lessons, student_id, group_id, amount, valid_from').returns<RateRow[]>()
      : Promise.resolve({ data: null as RateRow[] | null }),
    isOwner ? Promise.resolve([]) : pendingTeachers(supabase),
  ]);

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const payBy = new Map((payouts.data ?? []).map((r) => [r.teacher_id, r]));
  const teachers = (people.data ?? [])
    .filter((p) => (p.active && (p.role === 'teacher' || p.role === 'head_teacher')) || payBy.has(p.id))
    .map((p) => ({ person: p, pay: payBy.get(p.id) }))
    .sort((x, y) => Number(y.pay?.total ?? 0) - Number(x.pay?.total ?? 0) || x.person.full_name.localeCompare(y.person.full_name));
  const payTotal = (payouts.data ?? []).reduce((s, r) => s + Number(r.total), 0);
  const withPay = (payouts.data ?? []).length;
  const waiting = (payouts.data ?? []).filter((r) => r.review_status !== 'paid').length;
  const ended = notRenewed.data ?? [];
  const late = unmarked.data ?? [];

  return (
    <Shell profile={profile} t={t} active="/school">
      <div className="spread" style={{ alignItems: 'baseline', marginBottom: 16 }}>
        <h1 style={{ margin: 0, textTransform: 'capitalize' }}>{fmtMonth(month, profile.locale)}</h1>
        {isOwner && <span className="muted" style={{ fontSize: 13 }}>{t('autoFromLog')}</span>}
      </div>

      <div className="grid" style={{ marginBottom: 20 }}>
        {isOwner && (
          <Link href="/school/payouts" className="card stat">
            <span className="muted">{t('toPayTeachers')}</span>
            <span className="big">{fmtMoney(payTotal)}</span>
            <small>{t('teachersN', { n: withPay })}</small>
          </Link>
        )}
        {isOwner && (
          <Link href="/school/payouts" className="card stat">
            <span className="muted">{t('awaitingReview')}</span>
            <span className="big" style={{ color: 'var(--ink)' }}>{waiting} / {withPay}</span>
            <small>{t('reviewHint')}</small>
          </Link>
        )}
        <div className="card stat">
          <span className="muted">{t('notRenewed')}</span>
          <span className="big" style={{ color: 'var(--ink)' }}>{ended.length}</span>
          <small>{ended.slice(0, 3).map((s) => s.full_name).join(', ')}</small>
        </div>
        {!isOwner && (
          <div className="card stat">
            <span className="muted">{t('unmarkedOld')}</span>
            <span className="big" style={{ color: 'var(--ink)' }}>{late.length}</span>
          </div>
        )}
      </div>

      <div className="split">
        {isOwner && (
          <section className="card" aria-labelledby="pay-h">
            <div className="spread" style={{ marginBottom: 8 }}>
              <h2 id="pay-h" style={{ margin: 0 }}>{t('payouts')}</h2>
              <div className="row">
                <Link href="/school/payouts" className="btn small">{t('allDetails')}</Link>
                <a href={`/school/payouts/export?month=${month}`} className="btn small">{t('exportCsv')}</a>
              </div>
            </div>
            {teachers.length === 0 ? (
              <p className="muted">{t('noTeachersYet')}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{t('teacher')}</th><th>{t('ratesUah')}</th><th className="num">{t('sumUah')}</th><th>{t('status')}</th></tr>
                  </thead>
                  <tbody>
                    {teachers.map(({ person, pay }) => (
                      <tr key={person.id}>
                        <td style={{ fontWeight: 600 }}>
                          <Link href={`/school/payouts?open=${person.id}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>{person.full_name}</Link>
                        </td>
                        <td className="muted">{rateSummary((rates.data ?? []).filter((r) => r.teacher_id === person.id), t)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{pay ? fmtMoney(pay.total, pay.currency).replace(' грн', '') : '0'}</td>
                        <td>
                          {pay
                            ? <span className={`pill ${pay.review_status === 'paid' ? 'ok' : ''}`}>{t(`review_${pay.review_status}` as never)}</span>
                            : <span className="muted" style={{ fontSize: 13 }}>{t('noLessonsYet')}</span>}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>{t('total')}</td><td />
                      <td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtMoney(payTotal).replace(' грн', '')}</td><td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {profile.role === 'head_teacher' && (
          <section className="card" aria-labelledby="cab-h">
            <h2 id="cab-h" style={{ marginBottom: 4 }}>{t('teacherCabinets')}</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>{t('teacherCabinetsHint')}</p>
            <div className="stack" style={{ gap: 8 }}>
              {teachers.filter(({ person }) => person.id !== profile.id).map(({ person }) => (
                <Link key={person.id} href={`/teacher?as=${person.id}`} className="spread list-row">
                  <span style={{ fontWeight: 600 }}>{person.full_name}</span><span className="open-link">{t('open')}</span>
                </Link>
              ))}
              {invited.map((i) => (
                <Link key={i.email} href={`/teacher?as=${encodeURIComponent(`${INVITE}${i.email}`)}`} className="spread list-row">
                  <span style={{ fontWeight: 600 }}>{i.full_name} <span className="muted" style={{ fontWeight: 400 }}>· {t('pending')}</span></span>
                  <span className="open-link">{t('open')}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="card" aria-labelledby="att-h">
          <h2 id="att-h">{t('needAttention')}</h2>
          {ended.length === 0 && late.length === 0 && <p className="muted">{t('allClear')}</p>}
          <div className="stack" style={{ gap: 10 }}>
            {ended.map((s) => (
              <Link key={s.student_id} href={`/school/students/${s.student_id}`} className="attention">
                <strong>{s.full_name}{s.level ? ` · ${s.level}` : ''}</strong>
                <span>
                  {t('packageEndedHint', { teacher: nameOf.get(s.teacher_id) ?? '' })}
                  {s.last_valid_until ? ` · ${fmtDate(s.last_valid_until, profile.locale)}` : ''}
                </span>
              </Link>
            ))}
            {late.map((l) => (
              <Link key={l.id} href="/school/lessons" className="attention soft">
                <strong>{l.students?.full_name ?? l.groups?.name ?? ''}</strong>
                <span>{t('unmarkedHint', { teacher: l.pending_teacher ? `${l.invites?.full_name ?? l.pending_teacher} · ${t('pending')}` : l.profiles?.full_name ?? '', date: fmtDateTime(l.starts_at, profile.locale) })}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
