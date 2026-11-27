import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { SCHOOL_TZ } from '@/lib/i18n';
import { buildTasks, loadManagerData } from '@/lib/manager';
import ManagerTasks from '@/components/ManagerTasks';
import TaskCalendar from '@/components/TaskCalendar';

// The manager's day: whom to write to and why, and what is coming up.
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const data = await loadManagerData(supabase);
  const { tasks, events } = buildTasks(data);
  const nameOf = new Map(data.people.map((p) => [p.id, p.full_name]));
  const people = new Set(tasks.map((x) => x.student.id)).size;
  const title = new Intl.DateTimeFormat(profile.locale === 'uk' ? 'uk-UA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: SCHOOL_TZ }).format(new Date());

  return (
    <Shell profile={profile} t={t} active="/school/today">
      <div className="spread" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0 }}>{t('mgrTodayTitle', { date: title })}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{people ? t('todayLead', { n: people }) : t('tAllDone')}</p>
        </div>
        <div className="row">
          <Link href="/school/diagnostics" className="btn diag-btn">+ {t('diagAdd')}</Link>
          <Link href="/school/new" className="btn">+ {t('studentTo')}</Link>
          <Link href="/school/teachers" className="btn">{t('navTeachers')}</Link>
        </div>
      </div>
      <Flash error={sp.e === 'WHY_NEEDED' ? t('whyNeeded') : sp.e} />
      <div className="mgr-layout">
        <div className="mgr-main">
          <ManagerTasks tasks={tasks} t={t} locale={profile.locale} nameOf={nameOf} returnTo="/school/today" />
        </div>
        <aside className="mgr-side">
          <TaskCalendar events={events} t={t} locale={profile.locale} />
          <section className="card soft-note">
            <strong>{t('tHowTitle')}</strong>
            <p>{t('tHowText')}</p>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
