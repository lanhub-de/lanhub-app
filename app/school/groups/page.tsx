import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { fmtInTz } from '@/lib/i18n';
import { createGroup, createProgram } from '@/app/groups/actions';
import { INVITE, pendingTeachers } from '@/lib/invites';
import Submit from '@/components/Submit';

type Overview = {
  id: string; name: string; teacher_id: string | null; program_id: string | null; tz: string; active: boolean;
  capacity: number | null; members: number; lessons_total: number; lessons_done: number; first_at: string | null; next_at: string | null;
  pending_teacher: string | null; pending_teacher_name: string | null;
};

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const canEditPrograms = profile.role === 'owner' || profile.role === 'head_teacher';

  const [programs, lessonCounts, groups, people, invited] = await Promise.all([
    supabase.from('programs').select('id, title, level, active').eq('active', true).order('title'),
    supabase.from('program_lessons').select('program_id'),
    supabase.from('group_overview').select('id, name, teacher_id, program_id, tz, active, capacity, members, lessons_total, lessons_done, first_at, next_at, pending_teacher, pending_teacher_name')
      .eq('active', true).order('name').returns<Overview[]>(),
    supabase.from('profiles').select('id, full_name, role, active'),
    pendingTeachers(supabase),
  ]);

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const teachers = (people.data ?? []).filter((p) => p.active && ['teacher', 'head_teacher', 'owner'].includes(p.role));
  const lessonsIn = (pid: string) => (lessonCounts.data ?? []).filter((l) => l.program_id === pid).length;
  const groupsIn = (pid: string) => (groups.data ?? []).filter((g) => g.program_id === pid).length;
  const programTitle = new Map((programs.data ?? []).map((p) => [p.id, p.title]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Shell profile={profile} t={t} active="/school/groups">
      <h1 style={{ marginBottom: 4 }}>{t('navGroups')}</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{t('groupsIntro')}</p>
      <Flash error={sp.e} />

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ marginBottom: 4 }}>{t('programs')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('programsHint')}</p>
        <div className="grid">
          {(programs.data ?? []).map((p) => (
            <Link key={p.id} href={canEditPrograms ? `/school/programs/${p.id}` : '#'} className="card stat">
              <span className="eyebrow">{p.level ?? ''}</span>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{p.title}</span>
              <small>{t('lessonsN', { n: lessonsIn(p.id) })} · {t('groupsN', { n: groupsIn(p.id) })}</small>
            </Link>
          ))}
          {canEditPrograms && (
            <details className="card dashed">
              <summary>+ {t('newProgram')}</summary>
              <form action={createProgram} className="stack" style={{ marginTop: 12 }}>
                <label>{t('title')}<input name="title" required placeholder="German Activation · Flow 4" /></label>
                <label>{t('level')}<input name="level" placeholder="A2–B1" /></label>
                <label>{t('lessonsCountNew')}<input name="lessons" type="number" min={1} max={40} defaultValue={8} /></label>
                <Submit className="primary">{t('add')}</Submit>
              </form>
            </details>
          )}
        </div>
      </section>

      <details className="card" style={{ marginBottom: 28, borderColor: 'var(--red)' }}>
        <summary>+ {t('newGroup')}</summary>
        <form action={createGroup} className="stack" style={{ marginTop: 14 }}>
          <div className="form">
            <label>{t('program')}
              <select name="program_id" required defaultValue="">
                <option value="" disabled>…</option>
                {(programs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <label>{t('teacher')}
              <select name="teacher_id" required defaultValue="">
                <option value="" disabled>…</option>
                {teachers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                {invited.map((i) => <option key={i.email} value={`${INVITE}${i.email}`}>{i.full_name} · {t('pending')}</option>)}
              </select>
            </label>
            <label>{t('time')} ({t('groupTime')})<input name="time" type="time" required defaultValue="20:10" /></label>
            <label>{t('startDate')}<input name="start" type="date" required defaultValue={today} /></label>
            <label>{t('capacity')}<input name="capacity" type="number" min={1} max={40} defaultValue={10} /></label>
            <label>{t('zoomLink')}<input name="zoom_url" type="url" placeholder="https://zoom.us/j/…" /></label>
            <label>{t('groupNameOptional')}<input name="name" /></label>
          </div>
          <fieldset className="days">
            <legend>{t('days')}</legend>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="day">
                <input type="checkbox" name="days" value={d} />
                <span>{t(`wd${d}` as never)}</span>
              </label>
            ))}
          </fieldset>
          <p className="muted" style={{ margin: 0 }}>{t('createGroupHint')}</p>
          <div><Submit className="primary">{t('createGroup')}</Submit></div>
        </form>
      </details>

      <section className="stack">
        <h2 style={{ margin: 0 }}>{t('groupsNow')}</h2>
        {(groups.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
        {(groups.data ?? []).map((g) => {
          const started = g.lessons_done > 0 || (g.first_at !== null && g.first_at < new Date().toISOString());
          const progress = !g.lessons_total
            ? t('noProgram')
            : !started ? t('enrolling')
              : g.lessons_done >= g.lessons_total ? t('finishedFlow')
                : t('lessonNofM', { n: Math.min(g.lessons_done + 1, g.lessons_total), m: g.lessons_total });
          return (
            <Link key={g.id} href={`/groups/${g.id}`} className="card group-row">
              <div className="group-main">
                <strong style={{ fontSize: 17 }}>{g.name}</strong>
                <span className="muted">{g.pending_teacher ? `${g.pending_teacher_name ?? g.pending_teacher} · ${t('pending')}` : nameOf.get(g.teacher_id ?? '') ?? '—'}{g.program_id ? ` · ${programTitle.get(g.program_id) ?? ''}` : ''}</span>
              </div>
              <div className="group-cell">
                <span style={{ fontWeight: 600 }}>{progress}</span>
                {g.lessons_total > 0 && (
                  <span className="bar" role="img" aria-label={progress}>
                    {Array.from({ length: g.lessons_total }, (_, i) => <span key={i} className={i < g.lessons_done ? 'on' : ''} />)}
                  </span>
                )}
              </div>
              <div className="group-cell">
                <span className="muted">{t('studentsLabel')}</span>
                <strong>{g.members}{g.capacity ? ` / ${g.capacity}` : ''}</strong>
              </div>
              <div className="group-cell">
                <span className="muted">{t('nextLesson')}</span>
                <span>{g.next_at ? fmtInTz(g.next_at, g.tz, profile.locale) : '—'}</span>
              </div>
            </Link>
          );
        })}
      </section>
    </Shell>
  );
}
