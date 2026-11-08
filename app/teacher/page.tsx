import Shell, { Flash } from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import GroupLessonCard, { type Member } from '@/components/GroupLessonCard';
import Link from 'next/link';
import { requireProfile, TEACHING } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtMoney, fmtMonth } from '@/lib/i18n';
import { addLesson } from './actions';
import { LESSON_SELECT as select, toView, type LessonDb } from '@/lib/lessons';

export default async function TeacherPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 864e5).toISOString();
  const ago30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const month = currentMonthStart();

  const [unmarked, upcoming, recent, students, groups, packages, pay] = await Promise.all([
    supabase.from('lessons').select(select).eq('teacher_id', profile.id).is('pending_teacher', null).eq('status', 'scheduled')
      .lt('starts_at', now.toISOString()).gte('starts_at', ago30).order('starts_at').returns<LessonDb[]>(),
    supabase.from('lessons').select(select).eq('teacher_id', profile.id).is('pending_teacher', null)
      .gte('starts_at', now.toISOString()).lte('starts_at', in14).order('starts_at').returns<LessonDb[]>(),
    supabase.from('lessons').select(select).eq('teacher_id', profile.id).is('pending_teacher', null).neq('status', 'scheduled')
      .gte('starts_at', ago30).lt('starts_at', now.toISOString()).order('starts_at', { ascending: false })
      .limit(10).returns<LessonDb[]>(),
    supabase.from('students').select('id, full_name, level, teacher_id').eq('status', 'active').order('full_name'),
    supabase.from('groups').select('id, name, level').eq('teacher_id', profile.id).is('pending_teacher', null).eq('active', true).order('name'),
    supabase.from('package_usage').select('student_id, lessons_left, valid_until, status').eq('status', 'active'),
    supabase.from('monthly_payouts').select('total, lessons_count, currency')
      .eq('teacher_id', profile.id).eq('month', month),
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
    supabase.from('group_overview').select('id, name, members, lessons_total, lessons_done').eq('teacher_id', profile.id).is('pending_teacher', null).eq('active', true).order('name'),
  ]);
  const membersOf = (gid: string): Member[] => (memberRows.data ?? [])
    .filter((m) => m.group_id === gid).map((m) => ({ student_id: m.student_id, name: m.students?.full_name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const absentIn = (lid: string) => new Set((absenceRows.data ?? []).filter((a) => a.lesson_id === lid).map((a) => a.student_id));
  const row = (l: LessonDb) => l.group_id && l.program_lessons
    ? <GroupLessonCard key={l.id} lesson={l} members={membersOf(l.group_id)} absent={absentIn(l.id)} t={t} locale={profile.locale} returnTo="/teacher" />
    : <LessonRow key={l.id} lesson={toView(l)} t={t} locale={profile.locale} returnTo="/teacher" canMark />;

  const myStudents = (students.data ?? []).filter((s) => s.teacher_id === profile.id);
  const pkgByStudent = new Map((packages.data ?? []).map((p) => [p.student_id, p]));
  const payRow = pay.data?.[0];

  return (
    <Shell profile={profile} t={t} active="/teacher">
      <h1>{t('todayTitle')}</h1>
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

          <details className="card">
            <summary>+ {t('addLesson')}</summary>
            <form action={addLesson} className="form" style={{ marginTop: 12 }}>
              <input type="hidden" name="return_to" value="/teacher" />
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
          </details>

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
            <div className="big">{fmtMoney(payRow?.total ?? 0)}</div>
            <div className="muted">{payRow?.lessons_count ?? 0} {t('lessonsCount')}</div>
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
