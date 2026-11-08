import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import { fmtInTz } from '@/lib/i18n';
import { addMember, archiveGroup, continueGroup, removeMember, updateGroup } from '../actions';

type LessonRowDb = {
  id: string; starts_at: string; status: string; recording_url: string | null; teacher_id: string;
  program_lessons: { n: number; title: string; topic: string | null } | null;
};

export default async function GroupPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const sp = await searchParams;
  const staff = profile.role !== 'teacher';

  const { data: g } = await supabase.from('groups')
    .select('id, name, level, teacher_id, program_id, days, start_time, tz, capacity, zoom_url, active, continued_from')
    .eq('id', id).maybeSingle();
  if (!g) notFound();

  const [program, members, lessons, people, students] = await Promise.all([
    g.program_id
      ? supabase.from('programs').select('id, title, next_program_id').eq('id', g.program_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('group_members').select('student_id, students(full_name, level, market)').eq('group_id', id)
      .returns<{ student_id: string; students: { full_name: string; level: string | null; market: string } | null }[]>(),
    supabase.from('lessons').select('id, starts_at, status, recording_url, teacher_id, program_lessons(n, title, topic)')
      .eq('group_id', id).order('starts_at').returns<LessonRowDb[]>(),
    supabase.from('profiles').select('id, full_name, role, active'),
    staff ? supabase.from('students').select('id, full_name, level').eq('status', 'active').order('full_name') : Promise.resolve({ data: [] }),
  ]);
  const lessonIds = (lessons.data ?? []).map((l) => l.id);
  const { data: absences } = lessonIds.length
    ? await supabase.from('lesson_absences').select('lesson_id, student_id').in('lesson_id', lessonIds)
    : { data: [] as { lesson_id: string; student_id: string }[] };
  const { data: nextProgram } = program.data?.next_program_id
    ? await supabase.from('programs').select('title').eq('id', program.data.next_program_id).maybeSingle()
    : { data: null };

  const nameOf = new Map((people.data ?? []).map((p) => [p.id, p.full_name]));
  const teachers = (people.data ?? []).filter((p) => p.active && ['teacher', 'head_teacher', 'owner'].includes(p.role));
  const memberIds = new Set((members.data ?? []).map((m) => m.student_id));
  const absentCount = (lid: string) => (absences ?? []).filter((a) => a.lesson_id === lid).length;
  const done = (lessons.data ?? []).filter((l) => ['done', 'no_show', 'late_cancel'].includes(l.status)).length;
  const days = (g.days ?? []).map((d: number) => t(`wd${d}` as never)).join('/');
  const back = staff ? '/school/groups' : '/teacher';

  return (
    <Shell profile={profile} t={t} active={staff ? '/school/groups' : '/teacher'}>
      <p style={{ marginTop: 0 }}><Link href={back}>← {staff ? t('navGroups') : t('navToday')}</Link></p>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <h1 style={{ marginBottom: 6 }}>{g.name}</h1>
        {g.program_id && <Link href={`/groups/${g.id}/preview`} className="btn small">{t('c_viewAsStudent')}</Link>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {nameOf.get(g.teacher_id ?? '') ?? '—'}
        {days ? ` · ${days} ${String(g.start_time ?? '').slice(0, 5)} (${t('groupTime')})` : ''}
        {program.data ? ` · ${program.data.title}` : ''}
        {g.zoom_url ? <> · <a href={g.zoom_url} target="_blank" rel="noreferrer">Zoom</a></> : null}
      </p>
      <Flash error={sp.e} />

      <div className="split">
        <section className="card" aria-labelledby="ls-h">
          <div className="spread" style={{ marginBottom: 8 }}>
            <h2 id="ls-h" style={{ margin: 0 }}>{t('lessonsPlan')}</h2>
            <span className="muted">{done} / {(lessons.data ?? []).length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                {(lessons.data ?? []).map((l) => {
                  const counted = ['done', 'no_show', 'late_cancel'].includes(l.status);
                  const missed = absentCount(l.id);
                  return (
                    <tr key={l.id}>
                      <td style={{ width: 36, fontWeight: 700, color: 'var(--red)' }}>{l.program_lessons?.n ?? ''}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{l.program_lessons?.title ?? ''}</div>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {l.program_lessons?.topic ?? ''}
                          {l.teacher_id !== g.teacher_id ? ` · ${nameOf.get(l.teacher_id) ?? ''}` : ''}
                        </div>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtInTz(l.starts_at, g.tz, profile.locale)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {l.status !== 'scheduled' && <span className={`pill ${counted ? 'ok' : ''}`}>{t(`st_${l.status}` as never)}</span>}
                        {missed > 0 && <span className="muted" style={{ fontSize: 13 }}> · {t('absentN', { n: missed })}</span>}
                        {l.recording_url && <> · <a href={l.recording_url} target="_blank" rel="noreferrer">{t('recording')}</a></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {staff && program.data?.next_program_id && nextProgram && (
            <form action={continueGroup} className="stack" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sand)' }}>
              <input type="hidden" name="id" value={g.id} />
              <p className="muted" style={{ margin: 0 }}>{t('continueHint')}</p>
              <div><button type="submit" className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                {t('continueTo', { program: nextProgram.title })}
              </button></div>
            </form>
          )}
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="mem-h">
            <div className="spread" style={{ marginBottom: 6 }}>
              <h2 id="mem-h" style={{ margin: 0 }}>{t('members')}</h2>
              <span className="muted">{(members.data ?? []).length}{g.capacity ? ` / ${g.capacity}` : ''}</span>
            </div>
            {(members.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
            {(members.data ?? []).map((m) => (
              <div key={m.student_id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)' }}>
                {staff
                  ? <Link href={`/school/students/${m.student_id}`}>{m.students?.full_name}</Link>
                  : <span>{m.students?.full_name}</span>}
                <span className="row">
                  <span className="muted" style={{ fontSize: 13 }}>{m.students?.level ?? ''}</span>
                  {staff && (
                    <form action={removeMember}>
                      <input type="hidden" name="group_id" value={g.id} />
                      <input type="hidden" name="student_id" value={m.student_id} />
                      <button className="small" type="submit">{t('remove')}</button>
                    </form>
                  )}
                </span>
              </div>
            ))}
            {staff && (
              <details style={{ marginTop: 12 }}>
                <summary>+ {t('addMember')}</summary>
                <form action={addMember} className="stack" style={{ marginTop: 10 }}>
                  <input type="hidden" name="group_id" value={g.id} />
                  <label>{t('student')}
                    <select name="student_id" defaultValue="">
                      <option value="">{t('newStudent')} ↓</option>
                      {(students.data ?? []).filter((s) => !memberIds.has(s.id)).map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}{s.level ? ` · ${s.level}` : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label>{t('name')}<input name="full_name" /></label>
                  <label>{t('level')}<input name="level" placeholder="A2, B1…" /></label>
                  <label>{t('contact')}<input name="contact" /></label>
                  <label>{t('market')}
                    <select name="market" defaultValue="intl">
                      <option value="intl">{t('market_intl')}</option>
                      <option value="ua">{t('market_ua')}</option>
                    </select>
                  </label>
                  <button className="primary" type="submit">{t('add')}</button>
                </form>
              </details>
            )}
          </section>

          {staff && (
            <details className="card">
              <summary>{t('groupSettings')}</summary>
              <form action={updateGroup} className="stack" style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={g.id} />
                <label>{t('name')}<input name="name" defaultValue={g.name} required /></label>
                <label>{t('teacher')}
                  <select name="teacher_id" defaultValue={g.teacher_id ?? ''} required>
                    {teachers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </label>
                <label>{t('zoomLink')}<input name="zoom_url" type="url" defaultValue={g.zoom_url ?? ''} /></label>
                <label>{t('capacity')}<input name="capacity" type="number" min={1} defaultValue={g.capacity ?? 10} /></label>
                <p className="muted" style={{ margin: 0 }}>{t('groupSettingsHint')}</p>
                <button className="primary" type="submit">{t('save')}</button>
              </form>
              <form action={archiveGroup} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={g.id} />
                <button className="small" type="submit">{t('archiveGroup')}</button>
              </form>
            </details>
          )}
        </div>
      </div>
    </Shell>
  );
}
