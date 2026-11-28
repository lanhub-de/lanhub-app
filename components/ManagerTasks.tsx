import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { fmtDateTime, SCHOOL_TZ } from '@/lib/i18n';
import { TASK_COLOR, TASK_ORDER, type Task, type TaskKind } from '@/lib/manager';
import { markTask, recordPayment, setStudentStatus } from '@/app/school/actions';
import WhyForm from '@/components/WhyForm';
import Submit from '@/components/Submit';
import Insta from '@/components/Insta';

const fmtN = (n: number | undefined) => String(Math.round((n ?? 0) * 100) / 100).replace('.', ',');
const fmtDay = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', timeZone: SCHOOL_TZ }).format(new Date(iso));

export function Meter({ used, total, color, paid }: { used: number; total: number; color: string; paid?: number | null }) {
  const pct = Math.max(0, Math.min(100, (used / Math.max(total, 1)) * 100));
  return (
    <span className="meter">
      <span className="meter-bar" aria-hidden="true">
        <span style={{ width: `${pct}%`, background: color }} />
        {paid != null && paid < total && <i style={{ left: `${(paid / total) * 100}%` }} />}
      </span>
      {fmtN(used)} / {total}
    </span>
  );
}

function Wrote({ t, task, returnTo, label, mode = 'remind', className = '' }: { t: T; task: Task; returnTo: string; label?: string; mode?: 'remind' | 'done'; className?: string }) {
  return (
    <form action={markTask}>
      <input type="hidden" name="kind" value={task.kind} />
      <input type="hidden" name="ref" value={task.ref} />
      <input type="hidden" name="student_id" value={task.student.id} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="return_to" value={returnTo} />
      <Submit className={className}>{label ?? t('tWrote')}</Submit>
    </form>
  );
}

// The managers' to-do list, grouped by what to do. Each row says who, why
// now, and has the buttons that resolve it.
export default function ManagerTasks({
  tasks, t, locale, nameOf, returnTo, only, insta,
}: { tasks: Task[]; t: T; locale: Locale; nameOf: Map<string, string>; returnTo: string; only?: TaskKind[]; insta?: Map<string, string> }) {
  const kinds = (only ?? TASK_ORDER).filter((k) => tasks.some((x) => x.kind === k));
  if (kinds.length === 0) return <section className="card"><p className="muted" style={{ margin: 0 }}>{t('tAllDone')}</p></section>;
  const card = (id: string) => `/school/students/${id}`;
  return (
    <>
      {kinds.map((kind) => {
        const list = tasks.filter((x) => x.kind === kind);
        const color = TASK_COLOR[kind];
        return (
          <section key={kind} className="card task-sec" aria-labelledby={`tk-${kind}`}>
            <div className="task-head">
              <span className="task-dot" style={{ background: color }} aria-hidden="true" />
              <h2 id={`tk-${kind}`}>{t(`tk_${kind}` as never)}</h2>
              <span className="task-count" style={{ color, background: `${color}1a` }}>{list.length}</span>
              <span className="task-hint">{t(`tkh_${kind}` as never)}</span>
            </div>
            {list.map((task) => {
              const s = task.student;
              const teacher = nameOf.get(task.teacherId ?? '') ?? '';
              return (
                <div key={`${kind}-${task.ref}`} className="task-row">
                  <div className="task-main">
                    <div><Link href={card(s.id)} className="task-name">{s.full_name}</Link>
                      <span className="muted">{[s.level, teacher].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                      {insta?.get(s.id) && <> · <Insta handle={insta.get(s.id)} /></>}</div>
                    <div className="task-sub">
                      {kind === 'diagnostic' && t('tDiagSub', { date: fmtDateTime(task.lesson!.starts_at, locale) })}
                      {kind === 'last' && ((task.left ?? 1) <= 0 ? t('tLastDone') : task.next ? t('tLastSub', { date: fmtDateTime(task.next, locale) }) : t('tLastNoDate'))}
                      {kind === 'feedback' && t('tFeedbackSub', { used: fmtN(task.used), total: task.total ?? 0 })}
                      {kind === 'payment' && t('tPaySub', { paid: task.paid ?? 0, total: task.total ?? 0, used: fmtN(task.used) })}
                      {kind === 'renewal' && (task.expired
                        ? t('tRenewExpired', { date: task.ended ? fmtDay(task.ended, locale) : '', left: fmtN(task.left) })
                        : t('tRenewDone'))}
                      {kind === 'renewal' && task.uncovered ? ` · ${t('tUncovered', { n: task.uncovered })}` : ''}
                      {kind === 'nopackage' && t('tNoPkgSub', { done: task.uncovered ?? 0, planned: task.planned ?? 0 })}
                      {kind !== 'last' && kind !== 'diagnostic' && task.next ? ` · ${t('tNext', { date: fmtDateTime(task.next, locale) })}` : ''}
                    </div>
                  </div>
                  {task.total != null && task.used != null && kind !== 'renewal' && (
                    <Meter used={task.used} total={task.total} color={color} paid={kind === 'payment' ? task.paid : undefined} />
                  )}
                  <div className="task-actions">
                    {kind === 'diagnostic' && (
                      <>
                        <Link href={`${card(s.id)}?pkg=1#pkg`} className="btn small" style={{ background: color, borderColor: color, color: '#fff' }}>{t('tBought')}</Link>
                        <Wrote t={t} task={task} returnTo={returnTo} label={t('tThinking')} className="small" />
                        <WhyForm t={t} studentId={s.id} returnTo={returnTo} after="diagnostic" />
                      </>
                    )}
                    {(kind === 'last' || kind === 'renewal') && (
                      <>
                        <Wrote t={t} task={task} returnTo={returnTo} className="small" />
                        <Link href={`${card(s.id)}?pkg=1#pkg`} className="btn small primary">{t('tContinues')}</Link>
                        {kind === 'renewal' && (
                          <form action={setStudentStatus}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="status" value="paused" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <Submit className="small">{t('markPaused')}</Submit>
                          </form>
                        )}
                        <WhyForm t={t} studentId={s.id} returnTo={returnTo} />
                      </>
                    )}
                    {kind === 'feedback' && (
                      <>
                        <Wrote t={t} task={task} returnTo={returnTo} className="small" />
                        <Wrote t={t} task={task} returnTo={returnTo} mode="done" label={t('tFeedbackGot')} className="small blue" />
                      </>
                    )}
                    {kind === 'payment' && (
                      <>
                        <Wrote t={t} task={task} returnTo={returnTo} className="small" />
                        <details className="why">
                          <summary className="btn small amber">{t('tPaid')}</summary>
                          <form action={recordPayment} className="why-form">
                            <input type="hidden" name="student_id" value={s.id} />
                            <input type="hidden" name="package_id" value={task.pkg!.package_id} />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <label>{t('payForLessons')}<input name="lessons" type="number" min={1} max={task.total} defaultValue={(task.total ?? 0) - (task.paid ?? 0)} /></label>
                            <label>{t('payAmount')}<input name="amount" type="number" min={0} step="0.01" placeholder={t('optional')} /></label>
                            <label>€ / ₴
                              <select name="currency" defaultValue="UAH"><option value="UAH">UAH</option><option value="EUR">EUR</option><option value="USD">USD</option></select>
                            </label>
                            <Submit className="small dark">{t('save')}</Submit>
                          </form>
                        </details>
                      </>
                    )}
                    {kind === 'nopackage' && (
                      <>
                        <Wrote t={t} task={task} returnTo={returnTo} className="small" />
                        <Link href={`${card(s.id)}?pkg=1#pkg`} className="btn small primary">+ {t('addPackage')}</Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
