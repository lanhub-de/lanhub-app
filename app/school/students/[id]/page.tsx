import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import { requireProfile, STAFF } from '@/lib/session';
import { fmtDate, fmtMoney } from '@/lib/i18n';
import { LESSON_SELECT, toView, type LessonDb } from '@/lib/lessons';
import { INVITE, pendingTeachers } from '@/lib/invites';
import InviteStudent from '@/components/InviteStudent';
import { addPackage, addToGroup, deleteStudent, extendPackage, recordPayment, setStudentStatus, updatePackage, updateStudent } from '../../actions';
import Submit from '@/components/Submit';
import WhyForm from '@/components/WhyForm';
import PackageFields from '@/components/PackageFields';
import Insta from '@/components/Insta';

export default async function StudentPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; pkg?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const { id } = await params;
  const sp = await searchParams;
  const canSell = profile.role === 'owner' || profile.role === 'manager';
  // the head teacher manages packages too, but not payments
  const canPack = canSell || profile.role === 'head_teacher';

  const [student, teachers, packages, packageRows, payments, lessons, groups, memberships, invited] = await Promise.all([
    supabase.from('students').select('*').eq('id', id).maybeSingle(),
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher', 'owner']).eq('active', true).order('full_name'),
    supabase.from('package_usage').select('*').eq('student_id', id),
    supabase.from('packages').select('id, validity_months, note').eq('student_id', id),
    canSell ? supabase.from('student_payments').select('package_id, amount, currency, method, paid_at') : Promise.resolve({ data: [] }),
    supabase.from('lessons').select(LESSON_SELECT).eq('student_id', id).order('starts_at', { ascending: false }).limit(30).returns<LessonDb[]>(),
    supabase.from('groups').select('id, name').eq('active', true).order('name'),
    supabase.from('group_members').select('group_id').eq('student_id', id),
    pendingTeachers(supabase),
  ]);
  const { count: lessonCount } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('student_id', id);
  // Instagram: the owner and managers only
  const insta = canSell ? (await supabase.from('student_instagram').select('handle').eq('student_id', id).maybeSingle()).data?.handle ?? null : null;
  if (!student.data) notFound();
  const s = student.data;
  const pkgInfo = new Map((packageRows.data ?? []).map((p) => [p.id as string, p as { id: string; validity_months: number; note: string | null }]));
  const pkgs = (packages.data ?? []).sort((a, b) => String(b.first_lesson_at ?? '9').localeCompare(String(a.first_lesson_at ?? '9')));
  const paysByPkg = new Map<string, { amount: number; currency: string; method: string | null; paid_at: string }[]>();
  for (const p of (payments.data ?? []) as { package_id: string; amount: number; currency: string; method: string | null; paid_at: string }[]) {
    paysByPkg.set(p.package_id, [...(paysByPkg.get(p.package_id) ?? []), p]);
  }
  const inGroups = new Set((memberships.data ?? []).map((m) => m.group_id));

  return (
    <Shell profile={profile} t={t} active="/school/students">
      <p><Link href="/school/students">← {t('navStudents')}</Link></p>
      <div className="spread" style={{ alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: '0 0 6px' }}>{s.full_name}</h1>
          {insta && <p style={{ margin: '0 0 6px' }}><Insta handle={insta} /></p>}
        </div>
        <div className="row">
          <Link href={`/students/${id}/preview`} className="btn small">👁 {t('viewAsStudent')}</Link>
          {profile.role !== 'manager' && (s.teacher_id || s.pending_teacher) && (
            <Link className="btn small" href={`/teacher/students/${id}${s.pending_teacher ? `?as=${encodeURIComponent(INVITE + s.pending_teacher)}`
              : s.teacher_id !== profile.id ? `?as=${s.teacher_id}` : ''}`}>📁 {t('folder')}</Link>
          )}
        </div>
      </div>
      {s.schedule_note && <p className="muted" style={{ marginTop: 0 }}>{s.schedule_note}</p>}
      <Flash error={sp.e === 'HAS_LESSONS' ? t('hasLessons') : sp.e === 'WHY_NEEDED' ? t('whyNeeded') : sp.e} />
      <div className="grid" style={{ alignItems: 'start' }}>
        <section className="stack">
          <h2>{t('packages')}</h2>
          {pkgs.length === 0 && <p className="muted">{t('noPackage')}</p>}
          {/* the package is over: is she continuing? */}
          {(s.status !== 'active' || (pkgs.length > 0 && !pkgs.some((p) => p.status === 'active' || p.status === 'expired'))) && (
            <div className="attention">
              <strong>{s.status === 'active' ? t('packageOverTitle') : t('studentIs', { status: t(`stu_${s.status}` as never) })}</strong>
              {s.status === 'active' && <span>{t('packageOverHint')}</span>}
              {s.status === 'left' && s.left_reason && (
                <span>{t('whyShown', { why: t(`why_${s.left_reason}` as never) })}{s.left_note ? ` · ${s.left_note}` : ''}</span>
              )}
              <span className="row" style={{ marginTop: 6 }}>
                {(s.status === 'active' ? ['paused'] : ['active']).map((st) => (
                  <form key={st} action={setStudentStatus}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="status" value={st} />
                    <Submit className="small">{t(st === 'paused' ? 'markPaused' : 'markBack')}</Submit>
                  </form>
                ))}
                {s.status === 'active' && <WhyForm t={t} studentId={id} returnTo={`/school/students/${id}`} />}
              </span>
            </div>
          )}
          {pkgs.map((p) => (
            <div key={p.package_id} className="card stack">
              <div className="spread">
                <strong>{t('used', { used: p.lessons_used, total: p.lessons_total })}</strong>
                <span className={`pill ${p.status === 'active' ? 'ok' : 'warn'}`}>{t(`pkg_${p.status}` as never)}</span>
              </div>
              {p.valid_until && <span className="muted">{t(p.status === 'expired' ? 'pkgMonthOver' : 'validUntil', { date: fmtDate(p.valid_until, profile.locale) })}</span>}
              {p.status === 'expired' && <span className="muted">{t('pkgSpeedUp')}</span>}
              {p.paid_lessons != null && p.paid_lessons < p.lessons_total && (
                <span className="pay-due">{t('paidOfRest', { paid: p.paid_lessons, total: p.lessons_total, rest: p.lessons_total - p.paid_lessons })}</span>
              )}
              {canSell && p.paid_lessons != null && p.paid_lessons < p.lessons_total && (
                <details>
                  <summary className="link-btn">{t('recordPayment')}</summary>
                  <form action={recordPayment} className="form" style={{ marginTop: 10 }}>
                    <input type="hidden" name="student_id" value={id} />
                    <input type="hidden" name="package_id" value={p.package_id} />
                    <label>{t('payForLessons')}<input name="lessons" type="number" min={1} max={p.lessons_total} defaultValue={p.lessons_total - p.paid_lessons} /></label>
                    <label>{t('payAmount')}<input name="amount" type="number" min={0} step="0.01" placeholder={t('optional')} /></label>
                    <label>€ / ₴
                      <select name="currency" defaultValue={s.market === 'intl' ? 'EUR' : 'UAH'}>
                        <option value="UAH">UAH</option><option value="EUR">EUR</option><option value="USD">USD</option>
                      </select>
                    </label>
                    <label>{t('payDate')}<input name="paid_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                    <label>{t('method')}<input name="method" placeholder="WayForPay, monobank…" /></label>
                    <Submit className="primary small">{t('save')}</Submit>
                  </form>
                </details>
              )}
              {(paysByPkg.get(p.package_id) ?? []).map((pay, i) => (
                <span key={i} className="muted">
                  {fmtMoney(pay.amount, pay.currency)}{pay.method ? ` · ${pay.method}` : ''} · {fmtDate(pay.paid_at, profile.locale)}
                </span>
              ))}
              {pkgInfo.get(p.package_id)?.note && <span className="muted">{pkgInfo.get(p.package_id)?.note}</span>}
              {canPack && p.status === 'active' && (
                <form action={extendPackage} className="row">
                  <input type="hidden" name="student_id" value={id} />
                  <input type="hidden" name="package_id" value={p.package_id} />
                  <input name="days" type="number" min={1} defaultValue={7} style={{ width: 80 }} aria-label="days" />
                  <Submit className="small">+ {t('st_force_majeure')}</Submit>
                </form>
              )}
              {canPack && (
                <details>
                  <summary className="link-btn">{t('pkgEdit')}</summary>
                  <form action={updatePackage} className="form" style={{ marginTop: 10 }}>
                    <input type="hidden" name="student_id" value={id} />
                    <input type="hidden" name="package_id" value={p.package_id} />
                    <label>{t('lessonsTotal')}<input name="lessons_total" type="number" min={1} max={200} required defaultValue={p.lessons_total} /></label>
                    <label>{t('pkgMonths')}<input name="validity_months" type="number" min={1} max={24} required defaultValue={pkgInfo.get(p.package_id)?.validity_months ?? 1} /></label>
                    <label>{t('status')}
                      <select name="status" defaultValue={p.status === 'expired' ? 'active' : p.status}>
                        <option value="active">{t('pkg_active')}</option>
                        <option value="finished">{t('pkg_finished')}</option>
                        <option value="cancelled">{t('pkg_cancelled')}</option>
                      </select>
                    </label>
                    {canSell && (
                      <label>{t('paidLessonsEdit')}<input name="paid_lessons" type="number" min={1} max={p.lessons_total} defaultValue={p.paid_lessons ?? ''} placeholder={t('paidAllHint')} /></label>
                    )}
                    <label>{t('note')}<input name="note" defaultValue={pkgInfo.get(p.package_id)?.note ?? ''} placeholder={t('pkgNoteHint')} /></label>
                    <Submit className="primary small">{t('save')}</Submit>
                  </form>
                </details>
              )}
            </div>
          ))}
          {canPack && (
            <details className="card" id="pkg" open={sp.pkg === '1'}>
              <summary>+ {t('addPackage')}</summary>
              <form action={addPackage} className="stack" style={{ marginTop: 12 }}>
                <input type="hidden" name="student_id" value={id} />
                {!s.teacher_id && !s.pending_teacher && (
                  <label>{t('teacher')}
                    <select name="teacher_id" required defaultValue="">
                      <option value="" disabled>…</option>
                      {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      {invited.map((i) => <option key={i.email} value={`${INVITE}${i.email}`}>{i.full_name} · {t('pending')}</option>)}
                    </select>
                  </label>
                )}
                <PackageFields t={t} canSell={canSell} currency={s.market === 'intl' ? 'EUR' : 'UAH'} />
                <Submit className="primary">{t('addPackage')}</Submit>
              </form>
            </details>
          )}

          <h2 style={{ marginTop: 12 }}>{t('journal')}</h2>
          {(lessons.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {(lessons.data ?? []).map((l) => (
            <LessonRow key={l.id} lesson={toView(l, true, t('pending'))} t={t} locale={profile.locale} returnTo={`/school/students/${id}`} canMark canEdit />
          ))}
        </section>

        <section className="stack">
          <InviteStudent t={t} locale={profile.locale} returnTo={`/school/students/${id}`} s={s} />
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
            {canSell && <label>Instagram<input name="instagram" defaultValue={insta ?? ''} placeholder="@nick" maxLength={100} /></label>}
            <label>{t('contact')}<input name="contact" defaultValue={s.contact ?? ''} /></label>
            <label>{t('status')}
              <select name="status" defaultValue={s.status}>
                {['active', 'paused', 'left'].map((st) => <option key={st} value={st}>{t(`stu_${st}` as never)}</option>)}
              </select>
            </label>
            <label>{t('note')}<textarea name="notes" defaultValue={s.notes ?? ''} /></label>
            <Submit className="primary">{t('save')}</Submit>
          </form>

          <div className="card stack">
            <h2>{t('kind_group')}</h2>
            {(groups.data ?? []).filter((g) => inGroups.has(g.id)).map((g) => (
              <span key={g.id} className="spread">
                <Link href={`/groups/${g.id}`}>{g.name}</Link>
                <Link href={`/groups/${g.id}/preview`} className="btn small">{t('c_viewAsStudent')}</Link>
              </span>
            ))}
            <form action={addToGroup} className="row">
              <input type="hidden" name="student_id" value={id} />
              <select name="group_id" required defaultValue="">
                <option value="" disabled>…</option>
                {(groups.data ?? []).filter((g) => !inGroups.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <Submit className="small">{t('add')}</Submit>
            </form>
          </div>

          {(profile.role === 'owner' || (profile.role === 'manager' && !lessonCount)) && (
            <details className="card">
              <summary style={{ color: 'var(--red)' }}>{t('deleteStudent')}</summary>
              <p className="muted">{t('deleteStudentHint')}</p>
              <form action={deleteStudent} className="stack" style={{ gap: 10 }}>
                <input type="hidden" name="id" value={id} />
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" name="sure" value="1" required />
                  {t('deleteStudentSure', { name: s.full_name })}
                </label>
                <Submit className="small">{t('deleteStudent')}</Submit>
              </form>
            </details>
          )}
        </section>
      </div>
    </Shell>
  );
}
