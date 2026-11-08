import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import { requireProfile, STAFF } from '@/lib/session';
import { fmtDate, fmtMoney } from '@/lib/i18n';
import { LESSON_SELECT, toView, type LessonDb } from '@/lib/lessons';
import { INVITE, pendingTeachers } from '@/lib/invites';
import { addPackage, addToGroup, deleteStudent, extendPackage, updateStudent } from '../../actions';

export default async function StudentPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const { id } = await params;
  const sp = await searchParams;
  const canSell = profile.role === 'owner' || profile.role === 'manager';

  const [student, teachers, packages, payments, lessons, groups, memberships, invited] = await Promise.all([
    supabase.from('students').select('*').eq('id', id).maybeSingle(),
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher', 'owner']).eq('active', true).order('full_name'),
    supabase.from('package_usage').select('*').eq('student_id', id),
    canSell ? supabase.from('student_payments').select('package_id, amount, currency, method, paid_at') : Promise.resolve({ data: [] }),
    supabase.from('lessons').select(LESSON_SELECT).eq('student_id', id).order('starts_at', { ascending: false }).limit(30).returns<LessonDb[]>(),
    supabase.from('groups').select('id, name').eq('active', true).order('name'),
    supabase.from('group_members').select('group_id').eq('student_id', id),
    pendingTeachers(supabase),
  ]);
  if (!student.data) notFound();
  const s = student.data;
  const pkgs = (packages.data ?? []).sort((a, b) => String(b.first_lesson_at ?? '9').localeCompare(String(a.first_lesson_at ?? '9')));
  const paysByPkg = new Map<string, { amount: number; currency: string; method: string | null; paid_at: string }[]>();
  for (const p of (payments.data ?? []) as { package_id: string; amount: number; currency: string; method: string | null; paid_at: string }[]) {
    paysByPkg.set(p.package_id, [...(paysByPkg.get(p.package_id) ?? []), p]);
  }
  const inGroups = new Set((memberships.data ?? []).map((m) => m.group_id));

  return (
    <Shell profile={profile} t={t} active="/school/students">
      <p><Link href="/school/students">← {t('navStudents')}</Link></p>
      <h1>{s.full_name}</h1>
      <Flash error={sp.e === 'HAS_LESSONS' ? t('hasLessons') : sp.e} />
      <div className="grid" style={{ alignItems: 'start' }}>
        <section className="stack">
          <h2>{t('packages')}</h2>
          {pkgs.length === 0 && <p className="muted">{t('noPackage')}</p>}
          {pkgs.map((p) => (
            <div key={p.package_id} className="card stack">
              <div className="spread">
                <strong>{t('used', { used: p.lessons_used, total: p.lessons_total })}</strong>
                <span className={`pill ${p.status === 'active' ? 'ok' : 'warn'}`}>{t(`pkg_${p.status}` as never)}</span>
              </div>
              {p.valid_until && <span className="muted">{t('validUntil', { date: fmtDate(p.valid_until, profile.locale) })}</span>}
              {(paysByPkg.get(p.package_id) ?? []).map((pay, i) => (
                <span key={i} className="muted">
                  {fmtMoney(pay.amount, pay.currency)}{pay.method ? ` · ${pay.method}` : ''} · {fmtDate(pay.paid_at, profile.locale)}
                </span>
              ))}
              {canSell && p.status === 'active' && (
                <form action={extendPackage} className="row">
                  <input type="hidden" name="student_id" value={id} />
                  <input type="hidden" name="package_id" value={p.package_id} />
                  <input name="days" type="number" min={1} defaultValue={7} style={{ width: 80 }} aria-label="days" />
                  <button className="small" type="submit">+ {t('st_force_majeure')}</button>
                </form>
              )}
            </div>
          ))}
          {canSell && (
            <details className="card">
              <summary>+ {t('addPackage')}</summary>
              <form action={addPackage} className="form" style={{ marginTop: 12 }}>
                <input type="hidden" name="student_id" value={id} />
                <label>{t('lessonsTotal')}
                  <select name="lessons_total" defaultValue="8">
                    {[1, 4, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>{t('payment')}<input name="amount" type="number" min={0} step="0.01" /></label>
                <label>€ / ₴
                  <select name="currency" defaultValue={s.market === 'intl' ? 'EUR' : 'UAH'}>
                    <option value="UAH">UAH</option><option value="EUR">EUR</option><option value="USD">USD</option>
                  </select>
                </label>
                <label>{t('method')}<input name="method" placeholder="WayForPay, monobank…" /></label>
                <button className="primary" type="submit">{t('add')}</button>
              </form>
            </details>
          )}

          <h2 style={{ marginTop: 12 }}>{t('journal')}</h2>
          {(lessons.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {(lessons.data ?? []).map((l) => (
            <LessonRow key={l.id} lesson={toView(l, true, t('pending'))} t={t} locale={profile.locale} returnTo={`/school/students/${id}`} canMark />
          ))}
        </section>

        <section className="stack">
          <form action={updateStudent} className="card stack">
            <input type="hidden" name="id" value={id} />
            <label>{t('name')}<input name="full_name" defaultValue={s.full_name} required /></label>
            <label>{t('level')}<input name="level" defaultValue={s.level ?? ''} /></label>
            <label>{t('teacher')}
              <select name="teacher_id" defaultValue={s.pending_teacher ? `${INVITE}${s.pending_teacher}` : s.teacher_id ?? ''}>
                <option value="">…</option>
                {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                {invited.map((i) => <option key={i.email} value={`${INVITE}${i.email}`}>{i.full_name} · {t('pending')}</option>)}
              </select>
            </label>
            <label>{t('market')}
              <select name="market" defaultValue={s.market}>
                <option value="ua">{t('market_ua')}</option>
                <option value="intl">{t('market_intl')}</option>
              </select>
            </label>
            <label>{t('emailLabel')}<input type="email" name="email" defaultValue={s.email ?? ''} /></label>
            <label>{t('contact')}<input name="contact" defaultValue={s.contact ?? ''} /></label>
            <label>{t('status')}
              <select name="status" defaultValue={s.status}>
                <option value="active">active</option><option value="paused">paused</option><option value="left">left</option>
              </select>
            </label>
            <label>{t('note')}<textarea name="notes" defaultValue={s.notes ?? ''} /></label>
            <button className="primary" type="submit">{t('save')}</button>
          </form>

          <div className="card stack">
            <h2>{t('kind_group')}</h2>
            {(groups.data ?? []).filter((g) => inGroups.has(g.id)).map((g) => <span key={g.id}>{g.name}</span>)}
            <form action={addToGroup} className="row">
              <input type="hidden" name="student_id" value={id} />
              <select name="group_id" required defaultValue="">
                <option value="" disabled>…</option>
                {(groups.data ?? []).filter((g) => !inGroups.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button className="small" type="submit">{t('add')}</button>
            </form>
          </div>

          {profile.role === 'owner' && (
            <details className="card">
              <summary style={{ color: 'var(--red)' }}>{t('deleteStudent')}</summary>
              <p className="muted">{t('deleteStudentHint')}</p>
              <form action={deleteStudent} className="stack" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} />
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" name="sure" value="1" required />
                  {t('deleteStudentSure', { name: s.full_name })}
                </label>
                <button className="small" type="submit">{t('deleteStudent')}</button>
              </form>
            </details>
          )}
        </section>
      </div>
    </Shell>
  );
}
