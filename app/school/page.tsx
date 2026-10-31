import Link from 'next/link';
import Shell from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import { requireProfile, STAFF } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtMoney, fmtMonth } from '@/lib/i18n';
import { LESSON_SELECT, toView, type LessonDb } from '@/lib/lessons';

export default async function SchoolOverview() {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const month = currentMonthStart();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  const [notRenewed, unmarked, payouts, teachers] = await Promise.all([
    supabase.from('students_not_renewed').select('student_id, full_name, level, teacher_id, last_valid_until')
      .order('last_valid_until', { ascending: false }),
    supabase.from('lessons').select(LESSON_SELECT).eq('status', 'scheduled').lt('starts_at', dayAgo)
      .order('starts_at').limit(30).returns<LessonDb[]>(),
    profile.role === 'owner'
      ? supabase.from('monthly_payouts').select('teacher_name, total, lessons_count, review_status').eq('month', month)
      : Promise.resolve({ data: null }),
    supabase.from('profiles').select('id, full_name'),
  ]);

  const teacherName = new Map((teachers.data ?? []).map((p) => [p.id, p.full_name]));
  const payTotal = (payouts.data ?? []).reduce((s, r) => s + Number(r.total), 0);

  return (
    <Shell profile={profile} t={t} active="/school">
      <h1>{t('navOverview')}</h1>
      <div className="grid" style={{ marginBottom: 24 }}>
        {profile.role === 'owner' && (
          <Link href="/school/payouts" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="muted">{t('payoutsMonth', { month: fmtMonth(month, profile.locale) })}</div>
            <div className="big">{fmtMoney(payTotal)}</div>
          </Link>
        )}
        <div className="card">
          <div className="muted">{t('notRenewed')}</div>
          <div className="big">{notRenewed.data?.length ?? 0}</div>
        </div>
        <div className="card">
          <div className="muted">{t('unmarkedOld')}</div>
          <div className="big">{unmarked.data?.length ?? 0}</div>
        </div>
      </div>

      <div className="grid" style={{ alignItems: 'start' }}>
        <section className="card">
          <h2>{t('notRenewed')}</h2>
          {(notRenewed.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {(notRenewed.data ?? []).map((s) => (
            <div key={s.student_id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)' }}>
              <Link href={`/school/students/${s.student_id}`}>
                {s.full_name}{s.level ? ` · ${s.level}` : ''}
              </Link>
              <span className="muted">
                {teacherName.get(s.teacher_id) ?? ''}
                {s.last_valid_until ? ` · ${fmtDate(s.last_valid_until, profile.locale)}` : ''}
              </span>
            </div>
          ))}
        </section>
        <section className="stack" style={{ gridColumn: 'span 2' }}>
          <h2>{t('unmarkedOld')}</h2>
          {(unmarked.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {(unmarked.data ?? []).map((l) => (
            <LessonRow key={l.id} lesson={toView(l, true)} t={t} locale={profile.locale} returnTo="/school" canMark={false} />
          ))}
        </section>
      </div>
    </Shell>
  );
}
