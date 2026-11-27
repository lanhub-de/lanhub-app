import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { fmtDateTime, fmtInTz, SCHOOL_TZ } from '@/lib/i18n';
import { buildTasks, TASK_COLOR, taskFor, type ManagerData, type Pkg } from '@/lib/manager';
import { Meter } from '@/components/ManagerTasks';
import DiagnosticForm from '@/components/DiagnosticForm';

export type GroupRow = { id: string; name: string; teacher_id: string | null; tz: string; members: number; lessons_total: number; lessons_done: number; next_at: string | null };

// A folder per teacher: her students with their packages and what each needs
// now, her groups and her diagnostics.
export default function TeacherFolders({
  data, groups, selected, t, locale,
}: { data: ManagerData; groups: GroupRow[]; selected?: string; t: T; locale: Locale }) {
  const profile = { locale };
  const fmtDate = (iso: string, l: Locale) => new Intl.DateTimeFormat(l === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', timeZone: SCHOOL_TZ }).format(new Date(iso));
  const sp = { t: selected };
  const { tasks } = buildTasks(data);
  const teachers = data.people
    .filter((p) => p.active && ['teacher', 'head_teacher', 'owner'].includes(p.role))
    .map((p) => ({
      ...p,
      students: data.students.filter((s) => s.teacher_id === p.id),
      groups: groups.filter((g) => g.teacher_id === p.id),
      todo: tasks.filter((x) => x.teacherId === p.id).length,
    }))
    .filter((p) => p.role !== 'owner' || p.students.length || p.groups.length)
    .sort((a, b) => b.students.filter((s) => s.status === 'active').length - a.students.filter((s) => s.status === 'active').length
      || a.full_name.localeCompare(b.full_name));
  const sel = teachers.find((p) => p.id === sp.t) ?? teachers[0];
  const here = sel ? `/school/teachers?t=${sel.id}` : '/school/teachers';
  const pkgsOf = (id: string) => data.packages.filter((p) => p.student_id === id && p.status !== 'cancelled');
  const nowPkg = (id: string): Pkg | null => {
    const open = pkgsOf(id).filter((p) => (p.status === 'active' || p.status === 'expired') && Number(p.lessons_left) > 0);
    return open.find((p) => p.status === 'active') ?? open[0] ?? null;
  };
  const nextOf = (id: string) => data.upcoming.find((l) => l.student_id === id && l.kind === 'individual')?.starts_at ?? null;
  const active = sel ? sel.students.filter((s) => s.status === 'active') : [];
  const others = sel ? sel.students.filter((s) => s.status !== 'active') : [];
  const diags = sel ? data.diagnostics.filter((l) => l.teacher_id === sel.id).reverse() : [];
  const stuById = new Map(data.students.map((s) => [s.id, s]));
  const diagOutcome = (sid: string | null, at: string, status: string) => {
    const s = sid ? stuById.get(sid) : undefined;
    if (status === 'scheduled') return new Date(at) > new Date() ? { label: t('dg_planned'), cls: 'diag' } : { label: t('dg_unmarked'), cls: 'warn' };
    if (status !== 'done') return { label: t(`st_${status}` as never), cls: '' };
    if (s && pkgsOf(s.id).some((p) => new Date(p.created_at).getTime() > new Date(at).getTime() - 864e5)) return { label: t('dg_bought'), cls: 'ok' };
    if (s?.status === 'left') return { label: `${t('dg_notBought')}${s.left_reason ? `: ${t(`why_${s.left_reason}` as never)}` : ''}`, cls: '' };
    return { label: t('dg_waiting'), cls: 'diag' };
  };

  return (
      <div className="mgr-layout">
        <nav className="card t-list" aria-label={t('navTeachers')}>
          <div className="muted t-list-hint">{t('teachersHint', { n: teachers.length })}</div>
          {teachers.map((p) => {
            const n = p.students.filter((s) => s.status === 'active').length;
            const members = p.groups.reduce((sum, g) => sum + g.members, 0);
            return (
              <Link key={p.id} href={`/school/teachers?t=${p.id}`} className={`t-item ${sel?.id === p.id ? 'active' : ''}`} aria-current={sel?.id === p.id ? 'page' : undefined}>
                <span className="t-item-main">
                  <strong>{p.full_name}</strong>
                  <small>{[t('indivN', { n }), p.groups.length ? t('inGroupsN', { n: members, g: p.groups.length }) : ''].filter(Boolean).join(' · ')}</small>
                </span>
                {p.todo > 0 && <span className="t-badge">{p.todo}</span>}
              </Link>
            );
          })}
        </nav>

        {sel && (
          <div className="mgr-main">
            <div className="spread" style={{ alignItems: 'flex-end' }}>
              <div>
                <h1 style={{ margin: 0 }}>{sel.full_name}</h1>
                <p className="muted" style={{ margin: '4px 0 0' }}>{t('teacherSummary', { n: active.length, g: sel.groups.length })}</p>
              </div>
              <div className="row">
                <DiagnosticForm t={t} teacherId={sel.id} returnTo={here} teachers={[{ id: sel.id, full_name: sel.full_name }]}
                  students={data.students.filter((s) => s.status === 'active').map((s) => ({ id: s.id, full_name: s.full_name, level: s.level }))} />
                <Link href={`/school/new?teacher=${sel.id}`} className="btn primary">+ {t('studentTo', { name: sel.full_name })}</Link>
              </div>
            </div>

            <section className="card" style={{ padding: '6px 18px 10px' }}>
              {active.length === 0 ? <p className="muted">{t('nothingHere')}</p> : (
                <div className="table-wrap">
                  <table className="t-table">
                    <thead><tr><th>{t('student')}</th><th>{t('packages')}</th><th>{t('nextLesson')}</th><th>{t('whatToDo')}</th></tr></thead>
                    <tbody>
                      {active.map((s) => {
                        const p = nowPkg(s.id);
                        const task = taskFor(tasks, s.id);
                        const next = nextOf(s.id);
                        return (
                          <tr key={s.id}>
                            <td><Link href={`/school/students/${s.id}`} className="task-name">{s.full_name}</Link>{s.level && <span className="muted"> · {s.level}</span>}</td>
                            <td>
                              {p ? (
                                <>
                                  <Meter used={Number(p.lessons_used)} total={p.lessons_total} color={p.status === 'expired' ? '#8a817a' : '#a30000'} paid={p.paid_lessons} />
                                  <div className={`t-sub ${p.status === 'expired' ? 'over' : ''}`}>
                                    {p.status === 'expired' && p.valid_until ? t('pkgMonthOver', { date: fmtDate(p.valid_until, profile.locale) })
                                      : p.valid_until ? t('validUntil', { date: fmtDate(p.valid_until, profile.locale) }) : t('pkgNotStarted')}
                                    {p.paid_lessons != null ? ` · ${t('paidOf', { paid: p.paid_lessons, total: p.lessons_total })}` : ''}
                                  </div>
                                </>
                              ) : <span className="muted">{t('noPackage')}</span>}
                            </td>
                            <td>{next ? fmtDateTime(next, profile.locale) : <span className="muted">—</span>}</td>
                            <td>
                              {task
                                ? <span className="pill" style={{ background: `${TASK_COLOR[task.kind]}1a`, color: TASK_COLOR[task.kind] }}>{t(`tk_${task.kind}` as never)}</span>
                                : <span className="muted">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {others.length > 0 && (
                <details style={{ padding: '10px 0 4px' }}>
                  <summary>{t('pausedOrLeft', { n: others.length })}</summary>
                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                    {others.map((s) => (
                      <span key={s.id}>
                        <Link href={`/school/students/${s.id}`}>{s.full_name}</Link>
                        <span className="muted"> · {t(`stu_${s.status}` as never)}{s.left_reason ? ` · ${t(`why_${s.left_reason}` as never)}` : ''}</span>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </section>

            <section className="card">
              <h2>{t('navDiagnostics')}</h2>
              {diags.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('nothingHere')}</p>}
              {diags.map((l) => {
                const o = diagOutcome(l.student_id, l.starts_at, l.status);
                const s = l.student_id ? stuById.get(l.student_id) : undefined;
                return (
                  <div key={l.id} className="diag-row">
                    <span className="diag-when">{fmtDateTime(l.starts_at, profile.locale)}</span>
                    <span className="diag-who">{s ? <Link href={`/school/students/${s.id}`} className="task-name">{s.full_name}</Link> : '—'}{s?.level ? <span className="muted"> · {s.level}</span> : ''}</span>
                    <span className={`pill ${o.cls}`}>{o.label}</span>
                  </div>
                );
              })}
            </section>

            {sel.groups.length > 0 && (
              <section className="card">
                <h2>{t('navGroups')}</h2>
                <div className="grid">
                  {sel.groups.map((g) => (
                    <Link key={g.id} href={`/groups/${g.id}`} className="g-card">
                      <strong>{g.name}</strong>
                      <small>{t('groupLine', { n: g.members, done: g.lessons_done, total: g.lessons_total })}{g.next_at ? ` · ${fmtInTz(g.next_at, g.tz, profile.locale)}` : ''}</small>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
  );
}
