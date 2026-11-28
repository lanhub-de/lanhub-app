import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { fmtDateTime } from '@/lib/i18n';
import { buildTasks, loadManagerData } from '@/lib/manager';
import ManagerTasks from '@/components/ManagerTasks';
import DiagnosticForm from '@/components/DiagnosticForm';
import Insta from '@/components/Insta';

// Diagnostics: book one for a teacher, see what is coming, and after it is
// held offer a package (or note why she did not buy).
export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const data = await loadManagerData(supabase);
  const { tasks } = buildTasks(data);
  const nameOf = new Map(data.people.map((p) => [p.id, p.full_name]));
  const stuById = new Map(data.students.map((s) => [s.id, s]));
  const now = new Date();
  const upcoming = data.diagnostics.filter((l) => l.status === 'scheduled' && new Date(l.starts_at) > now);
  const unmarked = data.diagnostics.filter((l) => l.status === 'scheduled' && new Date(l.starts_at) <= now);
  const past = data.diagnostics.filter((l) => l.status !== 'scheduled').reverse();
  const bought = (sid: string | null, at: string) => !!sid && data.packages.some((p) => p.student_id === sid && p.status !== 'cancelled'
    && new Date(p.created_at).getTime() > new Date(at).getTime() - 864e5);
  const teachers = data.people.filter((p) => p.active && ['teacher', 'head_teacher', 'owner'].includes(p.role));

  const row = (l: (typeof data.diagnostics)[number], label?: React.ReactNode) => {
    const s = l.student_id ? stuById.get(l.student_id) : undefined;
    return (
      <div key={l.id} className="diag-row">
        <span className="diag-when">{fmtDateTime(l.starts_at, profile.locale)}</span>
        <span className="diag-who">
          {s ? <Link href={`/school/students/${s.id}`} className="task-name">{s.full_name}</Link> : '—'}
          <span className="muted">{[s?.level, nameOf.get(l.teacher_id)].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
          {s && data.insta.get(s.id) && <> · <Insta handle={data.insta.get(s.id)} /></>}
        </span>
        {label}
      </div>
    );
  };

  return (
    <Shell profile={profile} t={t} active="/school/diagnostics">
      <div className="spread" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0 }}>{t('navDiagnostics')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('diagIntro')}</p>
        </div>
        <DiagnosticForm t={t} returnTo="/school/diagnostics" teachers={teachers} instagram={profile.role === 'owner' || profile.role === 'manager'}
          students={data.students.filter((s) => s.status === 'active').map((s) => ({ id: s.id, full_name: s.full_name, level: s.level }))} />
      </div>
      <Flash error={sp.e === 'WHY_NEEDED' ? t('whyNeeded') : sp.e} />
      <div className="mgr-layout">
        <div className="mgr-main">
          <ManagerTasks tasks={tasks} only={['diagnostic']} t={t} locale={profile.locale} nameOf={nameOf} returnTo="/school/diagnostics" insta={data.insta} />
          {unmarked.length > 0 && (
            <section className="card">
              <h2>{t('dgUnmarkedTitle')}</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>{t('dgUnmarkedHint')}</p>
              {unmarked.map((l) => row(l, <span className="pill warn">{t('dg_unmarked')}</span>))}
            </section>
          )}
          <section className="card">
            <h2>{t('dgPast')}</h2>
            {past.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('nothingHere')}</p>}
            {past.map((l) => {
              const s = l.student_id ? stuById.get(l.student_id) : undefined;
              const label = l.status !== 'done' ? <span className="pill">{t(`st_${l.status}` as never)}</span>
                : bought(l.student_id, l.starts_at) ? <span className="pill ok">{t('dg_bought')}</span>
                  : s?.status === 'left' ? <span className="pill">{t('dg_notBought')}{s.left_reason ? `: ${t(`why_${s.left_reason}` as never)}` : ''}</span>
                    : <span className="pill diag">{t('dg_waiting')}</span>;
              return row(l, label);
            })}
          </section>
        </div>
        <aside className="mgr-side">
          <section className="card">
            <h2>{t('dgUpcoming')}</h2>
            {upcoming.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('nothingHere')}</p>}
            {upcoming.map((l) => row(l))}
          </section>
          <section className="card soft-note">
            <strong>{t('dgHowTitle')}</strong>
            <ol className="dg-steps">
              <li>{t('dgStep1')}</li><li>{t('dgStep2')}</li><li>{t('dgStep3')}</li><li>{t('dgStep4')}</li>
            </ol>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
