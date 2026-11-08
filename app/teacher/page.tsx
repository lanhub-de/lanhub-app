import Shell, { Flash } from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import GroupLessonCard, { type Member } from '@/components/GroupLessonCard';
import Link from 'next/link';
import { requireProfile, TEACHING } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtMoney, fmtMonth } from '@/lib/i18n';
import { addLesson } from './actions';
import { LESSON_SELECT as select, toView, type LessonDb } from '@/lib/lessons';
import { INVITE, pendingTeachers } from '@/lib/invites';
import type { SupabaseClient } from '@supabase/supabase-js';

type PayLine = {
  amount: number; currency: string;
  lessons: { kind: string; students: { full_name: string; level: string | null } | null; groups: { name: string } | null } | null;
};

// Whose cabinet this is: your own, or, for the owner and the head teacher,
// any teacher's (?as=<profile id>) or an invited one's (?as=invite:<email>),
// shown exactly as she will see it.
async function whoseCabinet(supabase: SupabaseClient, me: { id: string; full_name: string; role: string }, as?: string) {
  const own = { id: me.id, pending: null as string | null, name: me.full_name, viewing: false };
  if (!as || !(me.role === 'owner' || me.role === 'head_teacher')) return own;
  if (as.startsWith(INVITE)) {
    const email = as.slice(INVITE.length);
    const { data: name } = await supabase.rpc('pending_name', { e: email });
    return { id: me.id, pending: email, name: (name as string | null) ?? email, viewing: true };
  }
  const { data: p } = await supabase.from('profiles').select('id, full_name, role').eq('id', as).maybeSingle();
  if (!p || !['teacher', 'head_teacher', 'owner'].includes(p.role)) return own;
  return { id: p.id, pending: null, name: p.full_name, viewing: p.id !== me.id };
}

export default async function TeacherPage({ searchParams }: { searchParams: Promise<{ e?: string; as?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const who = await whoseCabinet(supabase, profile, sp.as);
  const here = who.viewing ? `/teacher?as=${encodeURIComponent(who.pending ? `${INVITE}${who.pending}` : who.id)}` : '/teacher';
  // lessons and groups of this teacher (waiting ones belong to the invite)
  const mine = <T,>(q: T): T => {
    type F = { eq: (c: string, v: string) => F; is: (c: string, v: null) => F };
    const f = q as unknown as F;
    return (who.pending ? f.eq('pending_teacher', who.pending) : f.eq('teacher_id', who.id).is('pending_teacher', null)) as unknown as T;
  };
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 864e5).toISOString();
  const ago30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const month = currentMonthStart();

  const [unmarked, upcoming, recent, students, groups, packages, pay] = await Promise.all([
    mine(supabase.from('lessons').select(select)).eq('status', 'scheduled')
      .lt('starts_at', now.toISOString()).gte('starts_at', ago30).order('starts_at').returns<LessonDb[]>(),
    mine(supabase.from('lessons').select(select))
      .gte('starts_at', now.toISOString()).lte('starts_at', in14).order('starts_at').returns<LessonDb[]>(),
    mine(supabase.from('lessons').select(select)).neq('status', 'scheduled')
      .gte('starts_at', ago30).lt('starts_at', now.toISOString()).order('starts_at', { ascending: false })
      .limit(10).returns<LessonDb[]>(),
    supabase.from('students').select('id, full_name, level, teacher_id, pending_teacher').eq('status', 'active').order('full_name'),
    mine(supabase.from('groups').select('id, name, level')).eq('active', true).order('name'),
    supabase.from('package_usage').select('student_id, lessons_left, valid_until, status').eq('status', 'active'),
    supabase.from('monthly_payouts').select('total, lessons_count, currency')
      .eq('teacher_id', who.id).eq('month', month),
  ]);
  const [payLines, extras, teachers, invited] = await Promise.all([
    who.pending ? Promise.resolve({ data: [] as PayLine[] })
      : supabase.from('lesson_pay')
        .select('amount, currency, lessons(kind, students!lessons_student_id_fkey(full_name, level), groups!lessons_group_id_fkey(name))')
        .eq('teacher_id', who.id).eq('month', month).returns<PayLine[]>(),
    who.pending ? Promise.resolve({ data: [] as { description: string; amount: number }[] })
      : supabase.from('payout_adjustments').select('description, amount').eq('teacher_id', who.id).eq('month', month),
    profile.role === 'owner' || profile.role === 'head_teacher'
      ? supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher']).eq('active', true).order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    profile.role === 'owner' ? pendingTeachers(supabase) : Promise.resolve([]),
  ]);

  // Group lessons: who is in each group and who missed which lesson.
  const all = [...(unmarked.data ?? []), ...(upcoming.data ?? []), ...(recent.data ?? [])];
  const groupIds = [...new Set(all.map((l) => l.group_id).filter(Boolean))] as string[];
  const groupLessonIds = all.filter((l) => l.group_id).map((l) => l.id);
  const [memberRows, absenceRows, myGroups] = await Promise.all([
    groupIds.length
      ? supabase.from('group_members').select('group_id, student_id, students(full_name)').in('group_id', groupIds)
        .returns<{ group_id: string; student_id: string; students: { full_name: string } | null }[]>()
      : Promise.resolve({ data: [] as { group_id: string; student_id: string; students: { full_name: string } | null }[] }),
    groupLessonIds.length
      ? supabase.from('lesson_absences').select('lesson_id, student_id').in('lesson_id', groupLessonIds)
      : Promise.resolve({ data: [] as { lesson_id: string; student_id: string }[] }),
    mine(supabase.from('group_overview').select('id, name, members, lessons_total, lessons_done')).eq('active', true).order('name'),
  ]);
  const membersOf = (gid: string): Member[] => (memberRows.data ?? [])
    .filter((m) => m.group_id === gid).map((m) => ({ student_id: m.student_id, name: m.students?.full_name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const absentIn = (lid: string) => new Set((absenceRows.data ?? []).filter((a) => a.lesson_id === lid).map((a) => a.student_id));
  const row = (l: LessonDb) => l.group_id && l.program_lessons
    ? <GroupLessonCard key={l.id} lesson={l} members={membersOf(l.group_id)} absent={absentIn(l.id)} t={t} locale={profile.locale} returnTo={here} />
    : <LessonRow key={l.id} lesson={toView(l)} t={t} locale={profile.locale} returnTo={here} canMark />;

  const myStudents = (students.data ?? []).filter((s) => (who.pending ? s.pending_teacher === who.pending : s.teacher_id === who.id && !s.pending_teacher));
  // this month's pay, one line per student or group: "Наталя · A2 · 3 × 450"
  const byWho = new Map<string, { n: number; sum: number; rate: Set<number> }>();
  for (const l of payLines.data ?? []) {
    const key = l.lessons?.students
      ? `${l.lessons.students.full_name}${l.lessons.students.level ? ` · ${l.lessons.students.level}` : ''}`
      : l.lessons?.groups?.name ?? t(`kind_${l.lessons?.kind ?? 'individual'}` as never);
    const x = byWho.get(key) ?? { n: 0, sum: 0, rate: new Set<number>() };
    x.n += 1; x.sum += Number(l.amount); x.rate.add(Number(l.amount));
    byWho.set(key, x);
  }
  const pkgByStudent = new Map((packages.data ?? []).map((p) => [p.student_id, p]));
  const payRow = pay.data?.[0];

  return (
    <Shell profile={profile} t={t} active="/teacher">
      {(teachers.data?.length || invited.length) ? (
        <div className="cabinet-switch">
          <span className="muted">{t('cabinetOf')}</span>
          <Link href="/teacher" className={!who.viewing ? 'active' : ''}>{t('cabinetMine')}</Link>
          {(teachers.data ?? []).filter((p) => p.id !== profile.id).map((p) => (
            <Link key={p.id} href={`/teacher?as=${p.id}`} className={who.viewing && !who.pending && who.id === p.id ? 'active' : ''}>{p.full_name}</Link>
          ))}
          {invited.map((i) => (
            <Link key={i.email} href={`/teacher?as=${encodeURIComponent(`${INVITE}${i.email}`)}`}
              className={who.pending === i.email ? 'active' : ''}>{i.full_name} · {t('pending')}</Link>
          ))}
        </div>
      ) : null}
      {who.viewing && (
        <div className="flash" style={{ marginBottom: 16 }}>
          {t(who.pending ? 'cabinetViewingPending' : 'cabinetViewing', { name: who.name })}
        </div>
      )}
      <h1>{who.viewing ? t('cabinetTitle', { name: who.name }) : t('todayTitle')}</h1>
      <Flash error={sp.e} />

      {(unmarked.data?.length ?? 0) > 0 && (
        <section className="stack" style={{ marginBottom: 28 }}>
          <h2>{t('needsMarking')} · {unmarked.data!.length}</h2>
          <p className="muted">{t('needsMarkingHint')}</p>
          {unmarked.data!.map(row)}
        </section>
      )}

      <div className="grid" style={{ alignItems: 'start' }}>
        <section className="stack" style={{ gridColumn: 'span 2' }}>
          <h2>{t('upcoming')}</h2>
          {(upcoming.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {(upcoming.data ?? []).map(row)}

          {!who.pending && <details className="card">
            <summary>+ {t('addLesson')}</summary>
            <form action={addLesson} className="form" style={{ marginTop: 12 }}>
              <input type="hidden" name="return_to" value={here} />
              {who.viewing && !who.pending && <input type="hidden" name="teacher_id" value={who.id} />}
              <label>
                {t('whoWith')}
                <select name="who" required defaultValue="">
                  <option value="" disabled>…</option>
                  {myStudents.map((s) => (
                    <option key={s.id} value={`s:${s.id}`}>{s.full_name}{s.level ? ` · ${s.level}` : ''}</option>
                  ))}
                  {(groups.data ?? []).map((g) => (
                    <option key={g.id} value={`g:${g.id}`}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('date')} · {t('time')}
                <input type="datetime-local" name="starts_at" required />
              </label>
              <label>
                {t('zoomLink')}
                <input type="url" name="zoom_url" placeholder="https://zoom.us/j/…" />
              </label>
              <button className="primary" type="submit">{t('add')}</button>
            </form>
          </details>}

          {(recent.data ?? []).length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>{t('journal')}</h2>
              {recent.data!.map(row)}
            </>
          )}
        </section>

        <aside className="stack">
          <div className="card">
            <h2>{t('myPay', { month: fmtMonth(month, profile.locale) })}</h2>
            {who.pending ? (
              <p className="muted" style={{ margin: 0 }}>{t('payAfterSignIn', { name: who.name })}</p>
            ) : (
              <>
                <div className="big">{fmtMoney(payRow?.total ?? 0)}</div>
                <div className="muted">{payRow?.lessons_count ?? 0} {t('lessonsCount')}</div>
                {(byWho.size > 0 || (extras.data ?? []).length > 0) && (
                  <div className="pay-lines">
                    {[...byWho.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([k, x]) => (
                      <div key={k} className="spread">
                        <span>{k}</span>
                        <span className="muted">{x.rate.size === 1 ? `${x.n} × ${[...x.rate][0]} = ` : `${x.n} · `}{fmtMoney(x.sum)}</span>
                      </div>
                    ))}
                    {(extras.data ?? []).map((a, i) => (
                      <div key={`x${i}`} className="spread"><span>{a.description}</span><span className="muted">{fmtMoney(a.amount)}</span></div>
                    ))}
                  </div>
                )}
                <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>{t('payHint')}</p>
              </>
            )}
          </div>
          {(myGroups.data ?? []).length > 0 && (
            <div className="card">
              <h2>{t('myGroups')}</h2>
              {myGroups.data!.map((g) => (
                <Link key={g.id} href={`/groups/${g.id}`} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)', color: 'var(--ink)', textDecoration: 'none' }}>
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{g.lessons_done}/{g.lessons_total} · {g.members}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="card">
            <h2>{t('myStudents')}</h2>
            {myStudents.length === 0 && <p className="muted">{t('nothingHere')}</p>}
            {myStudents.map((s) => {
              const p = pkgByStudent.get(s.id);
              return (
                <div key={s.id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)' }}>
                  <span>{s.full_name}{s.level ? <span className="muted"> · {s.level}</span> : null}</span>
                  <span className={`pill ${p ? (p.lessons_left <= 2 ? 'warn' : '') : 'warn'}`}>
                    {p
                      ? `${t('lessonsLeft', { n: p.lessons_left })}${p.valid_until ? ` · ${t('validUntil', { date: fmtDate(p.valid_until, profile.locale) })}` : ''}`
                      : t('noPackage')}
                  </span>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
