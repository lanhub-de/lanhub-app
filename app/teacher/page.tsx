import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import GroupLessonCard, { type Member } from '@/components/GroupLessonCard';
import TodayLessonCard, { type FileRef } from '@/components/TodayLessonCard';
import { pickerGroups, type Folder, type LibFile } from '@/lib/library';
import ScheduleLesson from '@/components/ScheduleLesson';
import { requireProfile, TEACHING } from '@/lib/session';
import { currentMonthStart, fmtDate, fmtDateTime, fmtMoney, fmtMonth, kyivLocalToIso, SCHOOL_TZ } from '@/lib/i18n';
import { openChat } from '@/app/chat/actions';
import { LESSON_SELECT as select, type LessonDb } from '@/lib/lessons';
import { asParam, CabinetSwitch, onlyTheirs, whoseCabinet } from '@/lib/cabinet';

type PayLine = {
  amount: number; currency: string;
  lessons: { kind: string; students: { full_name: string; level: string | null } | null; groups: { name: string } | null } | null;
};
type Chat = { id: string; title: string; last_body: string | null; unread: number; mine: boolean };

const dayKey = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, dateStyle: 'short' }).format(new Date(d));

export default async function TeacherPage({ searchParams }: { searchParams: Promise<{ e?: string; as?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const who = await whoseCabinet(supabase, profile, sp.as);
  const q = asParam(who);
  const here = q ? `/teacher?${q}` : '/teacher';
  const theirs = <Q,>(x: Q) => onlyTheirs(who, x);
  const now = new Date();
  const today = dayKey(now);
  const startToday = new Date(kyivLocalToIso(`${today}T00:00`)); // midnight in Kyiv
  const in14 = new Date(now.getTime() + 14 * 864e5).toISOString();
  const ago30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const month = currentMonthStart();

  const [unmarked, ahead, recent, students, groups, packages, pay, payLines, extras, toCheck, settings] = await Promise.all([
    theirs(supabase.from('lessons').select(select)).eq('status', 'scheduled')
      .lt('starts_at', startToday.toISOString()).gte('starts_at', ago30).order('starts_at').returns<LessonDb[]>(),
    theirs(supabase.from('lessons').select(select))
      .gte('starts_at', startToday.toISOString()).lte('starts_at', in14).order('starts_at').returns<LessonDb[]>(),
    theirs(supabase.from('lessons').select(select)).neq('status', 'scheduled')
      .gte('starts_at', ago30).lt('starts_at', startToday.toISOString()).order('starts_at', { ascending: false })
      .limit(8).returns<LessonDb[]>(),
    supabase.from('students').select('id, full_name, level, teacher_id, pending_teacher, schedule_note').eq('status', 'active').order('full_name'),
    theirs(supabase.from('group_overview').select('id, name, members, lessons_total, lessons_done')).eq('active', true).order('name'),
    supabase.from('package_usage').select('student_id, lessons_left, valid_until, status').eq('status', 'active'),
    supabase.from('monthly_payouts').select('total, lessons_count, currency').eq('teacher_id', who.id).eq('month', month),
    who.pending ? Promise.resolve({ data: [] as PayLine[] })
      : supabase.from('lesson_pay')
        .select('amount, currency, lessons(kind, students!lessons_student_id_fkey(full_name, level), groups!lessons_group_id_fkey(name))')
        .eq('teacher_id', who.id).eq('month', month).returns<PayLine[]>(),
    who.pending ? Promise.resolve({ data: [] as { description: string; amount: number }[] })
      : supabase.from('payout_adjustments').select('description, amount').eq('teacher_id', who.id).eq('month', month),
    who.pending ? Promise.resolve({ count: 0 })
      : supabase.from('homework').select('id, lessons!inner(teacher_id, pending_teacher)', { count: 'exact', head: true })
        .eq('status', 'submitted').eq('lessons.teacher_id', who.id).is('lessons.pending_teacher', null),
    who.pending ? Promise.resolve({ data: null })
      : supabase.from('teacher_settings').select('zoom_url').eq('teacher_id', who.id).maybeSingle(),
  ]);
  const teacherZoom = (settings.data as { zoom_url: string | null } | null)?.zoom_url ?? null;
  // a teacher's pay: her own, and the owner's; the head teacher sees cabinets but not pay
  const showPay = !who.viewing || profile.role === 'owner';
  // for the school and the head teacher looking at a cabinet: recordings and
  // materials of the last two months, to see how lessons go
  type Review = { id: string; starts_at: string; status: string; recording_url: string | null; note: string | null; homework_text: string | null;
    group_id: string | null; students: { full_name: string } | null; groups: { name: string } | null; program_lessons: { n: number; title: string } | null };
  const review = who.viewing
    ? ((await theirs(supabase.from('lessons')
        .select('id, starts_at, status, recording_url, note, homework_text, group_id, students!lessons_student_id_fkey(full_name), groups!lessons_group_id_fkey(name), program_lessons(n, title)'))
        .in('status', ['done', 'no_show', 'late_cancel']).gte('starts_at', new Date(Date.now() - 60 * 864e5).toISOString())
        .order('starts_at', { ascending: false }).limit(40).returns<Review[]>()).data ?? [])
    : [];
  // unread chats only make sense for your own cabinet
  const chats = who.viewing ? [] : (((await supabase.rpc('my_chats')).data ?? []) as Chat[]).filter((c) => c.mine && c.unread > 0);

  const todays = (ahead.data ?? []).filter((l) => dayKey(l.starts_at) === today);
  const later = (ahead.data ?? []).filter((l) => dayKey(l.starts_at) !== today);
  const all = [...(unmarked.data ?? []), ...(ahead.data ?? []), ...(recent.data ?? [])];
  const groupIds = [...new Set(all.map((l) => l.group_id).filter(Boolean))] as string[];
  const groupLessonIds = all.filter((l) => l.group_id).map((l) => l.id);
  const soloIds = [...new Set([...all.filter((l) => !l.group_id).map((l) => l.id), ...review.filter((l) => !l.group_id).map((l) => l.id)])];
  const [memberRows, absenceRows, attached, libraryFiles, libraryFolders] = await Promise.all([
    groupIds.length
      ? supabase.from('group_members').select('group_id, student_id, students(full_name)').in('group_id', groupIds)
        .returns<{ group_id: string; student_id: string; students: { full_name: string } | null }[]>()
      : Promise.resolve({ data: [] as { group_id: string; student_id: string; students: { full_name: string } | null }[] }),
    groupLessonIds.length
      ? supabase.from('lesson_absences').select('lesson_id, student_id').in('lesson_id', groupLessonIds)
      : Promise.resolve({ data: [] as { lesson_id: string; student_id: string }[] }),
    soloIds.length
      ? supabase.from('lesson_files').select('lesson_id, files(id, title, level)').in('lesson_id', soloIds)
        .returns<{ lesson_id: string; files: FileRef | null }[]>()
      : Promise.resolve({ data: [] as { lesson_id: string; files: FileRef | null }[] }),
    supabase.from('files').select('id, title, folder_id, level, staff_only, size_bytes, mime, visibility, uploaded_by')
      .eq('visibility', 'library').eq('staff_only', false).order('title').returns<LibFile[]>(),
    supabase.from('library_folders').select('id, name, parent_id').returns<Folder[]>(),
  ]);
  // "+ from the library": grouped by folder, teacher guides and audio left out
  const libraryRefs: FileRef[] = pickerGroups(libraryFiles.data ?? [], libraryFolders.data ?? [], t('libNoFolder'))
    .flatMap(([group, files]) => files.map((f) => ({ id: f.id, title: f.title, level: f.level, group })));
  const materialsOf = (lid: string) => (attached.data ?? []).filter((a) => a.lesson_id === lid && a.files).map((a) => a.files!);
  const membersOf = (gid: string): Member[] => (memberRows.data ?? [])
    .filter((m) => m.group_id === gid).map((m) => ({ student_id: m.student_id, name: m.students?.full_name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const absentIn = (lid: string) => new Set((absenceRows.data ?? []).filter((a) => a.lesson_id === lid).map((a) => a.student_id));
  const card = (l: LessonDb, showDay = false) => l.group_id && l.program_lessons
    ? <GroupLessonCard key={l.id} lesson={l} members={membersOf(l.group_id)} absent={absentIn(l.id)} t={t} locale={profile.locale} returnTo={here} />
    : <TodayLessonCard key={l.id} lesson={l} t={t} locale={profile.locale} returnTo={here} showDay={showDay}
        materials={materialsOf(l.id)} library={libraryRefs} userId={profile.id} teacherZoom={teacherZoom} />;

  const myStudents = (students.data ?? []).filter((s) => (who.pending ? s.pending_teacher === who.pending : s.teacher_id === who.id && !s.pending_teacher));
  const pkgByStudent = new Map((packages.data ?? []).map((p) => [p.student_id, p]));
  const payRow = pay.data?.[0];
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
  const markedToday = all.filter((l) => l.status !== 'scheduled' && dayKey(l.starts_at) === today).length;
  const firstToday = todays.find((l) => l.status === 'scheduled');
  const timeOf = (iso: string) => new Intl.DateTimeFormat('uk-UA', { timeZone: SCHOOL_TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const homeworkCount = (toCheck as { count: number | null }).count ?? 0;

  return (
    <Shell profile={profile} t={t} active="/teacher">
      <CabinetSwitch supabase={supabase} me={profile} who={who} base="/teacher" t={t} />
      {who.viewing && (
        <div className="flash" style={{ marginBottom: 16 }}>
          {t(who.pending ? 'cabinetViewingPending' : 'cabinetViewing', { name: who.name })}
        </div>
      )}
      <Flash error={sp.e} />

      <div className="cabinet">
        <section className="stack cabinet-main">
          <div className="spread" style={{ alignItems: 'center' }}>
            <div>
              <h1 style={{ margin: 0 }}>{who.viewing ? t('cabinetTitle', { name: who.name }) : t('todayHeading')}</h1>
              <span className="muted" style={{ fontSize: 13 }}>{t('todayHint')}</span>
            </div>
            <ScheduleLesson t={t} returnTo={here}
              students={myStudents.map((s) => ({ id: s.id, name: s.full_name, level: s.level }))}
              groups={(groups.data ?? []).map((g) => ({ id: g.id, name: g.name }))}
              teacherId={who.viewing && !who.pending ? who.id : undefined}
              pending={who.pending}
              school={profile.role === 'owner' || profile.role === 'head_teacher'} />
          </div>

          {(unmarked.data?.length ?? 0) > 0 && (
            <div className="stack">
              <h2 style={{ margin: '6px 0 0', color: 'var(--red)' }}>{t('needsMarking')} · {unmarked.data!.length}</h2>
              <p className="muted" style={{ margin: 0 }}>{t('needsMarkingHint')}</p>
              {unmarked.data!.map((l) => card(l, true))}
            </div>
          )}

          {todays.length === 0
            ? <div className="card muted">{t('noLessonsToday')}</div>
            : todays.map((l) => card(l))}

          {!who.pending && !teacherZoom && !who.viewing && (
            <Link href="/settings" className="notice">
              <strong>{t('addZoomRoom')}</strong>
              <span>{t('myZoomRoomHint')}</span>
            </Link>
          )}

          <div className="card today-stats">
            <span>{t('markedToday')}: <strong>{markedToday}</strong></span>
            {!who.pending && showPay && <span>{t('addedThisMonth')}: <strong>{fmtMoney(payRow?.total ?? 0)}</strong></span>}
          </div>

          {later.length > 0 && (
            <>
              <h2 style={{ margin: '10px 0 0' }}>{t('upcoming')}</h2>
              {later.map((l) => card(l, true))}
            </>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('myStudents')}</h2>
            {myStudents.length === 0 && <p className="muted">{t('nothingHere')}</p>}
            <div className="students-grid">
              {myStudents.map((s) => {
                const p = pkgByStudent.get(s.id);
                return (
                  <div key={s.id} className="student-tile">
                    <strong>{s.full_name}</strong>
                    <span className="muted" style={{ fontSize: 13 }}>{[s.level, s.schedule_note].filter(Boolean).join(' · ')}</span>
                    <span className={`pill ${p ? (p.lessons_left <= 2 ? 'warn' : '') : 'warn'}`} style={{ alignSelf: 'flex-start' }}>
                      {p ? `${t('lessonsLeft', { n: p.lessons_left })}${p.valid_until ? ` · ${t('validUntil', { date: fmtDate(p.valid_until, profile.locale) })}` : ''}` : t('noPackage')}
                    </span>
                    <Link href={`/teacher/students/${s.id}${q ? `?${q}` : ''}`} className="small-link">{t('folder')}</Link>
                    {who.pending ? (
                      <span className="link-btn off" title={t('chatAfterSignIn', { name: who.name })}>{t('write')}</span>
                    ) : (
                      <form action={openChat}>
                        <input type="hidden" name="kind" value="direct" />
                        <input type="hidden" name="student_id" value={s.id} />
                        <input type="hidden" name="teacher_id" value={who.id} />
                        <button type="submit" className="link-btn">{t('write')}</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {(recent.data ?? []).length > 0 && (
            <details className="card">
              <summary>{t('journal')}</summary>
              <div className="stack" style={{ marginTop: 10 }}>{recent.data!.map((l) => card(l, true))}</div>
            </details>
          )}

          {who.viewing && (
            <div className="card">
              <div className="spread" style={{ alignItems: 'baseline' }}>
                <h2 style={{ margin: 0 }}>{t('reviewTitle')}</h2>
                <span className="muted" style={{ fontSize: 13 }}>{t('recordingsHint', { n: review.filter((l) => l.recording_url).length, m: review.length })}</span>
              </div>
              {review.length === 0 && <p className="muted" style={{ margin: '10px 0 0' }}>{t('reviewEmpty')}</p>}
              <div className="review-list">
                {review.map((l) => {
                  const files = materialsOf(l.id);
                  const whoName = l.students?.full_name ?? l.groups?.name ?? '';
                  const topic = l.program_lessons ? `${t('c_lesson', { n: l.program_lessons.n })} · ${l.program_lessons.title}` : l.note;
                  return (
                    <div key={l.id} className="review-row">
                      <span className="review-when">{fmtDateTime(l.starts_at, profile.locale)}</span>
                      <span className="review-what">
                        <strong>{whoName}</strong>
                        {topic && <span className="muted"> · {topic}</span>}
                        {l.status !== 'done' && <span className="pill" style={{ marginLeft: 6 }}>{t(`st_${l.status}` as never)}</span>}
                        {(files.length > 0 || l.group_id) && (
                          <span className="review-files">
                            {files.map((f) => <Link key={f.id} href={`/library/${f.id}`} className="file-chip" style={{ paddingRight: 10 }}>📄 {f.title}</Link>)}
                            {l.group_id && l.program_lessons && (
                              <Link href={`/groups/${l.group_id}?l=${l.program_lessons.n}`} className="file-chip" style={{ paddingRight: 10 }}>📘 {t('lessonMaterials')}</Link>
                            )}
                          </span>
                        )}
                      </span>
                      {l.recording_url
                        ? <a href={l.recording_url} target="_blank" rel="noreferrer" className="btn small">▶ {t('c_watch')}</a>
                        : <span className="muted" style={{ fontSize: 13 }}>{t('noRecording')}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className="stack cabinet-side">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('notifications')}</h2>
            <div className="stack" style={{ gap: 8 }}>
              {chats.slice(0, 3).map((c) => (
                <Link key={c.id} href={`/chat?c=${c.id}`} className="notice">
                  <strong>{t('wroteYou', { name: c.title })}</strong>
                  <span>{c.last_body}</span>
                </Link>
              ))}
              {homeworkCount > 0 && (
                <Link href={`/teacher/homework${q ? `?${q}` : ''}`} className="notice">
                  <strong>{t('hwToCheck')}: {homeworkCount}</strong>
                  <span>{t('hwToCheckHint')}</span>
                </Link>
              )}
              <div className="notice calm">
                <strong>{t('todayCount', { n: todays.length })}</strong>
                <span>{firstToday ? t('firstAt', { time: timeOf(firstToday.starts_at), who: firstToday.students?.full_name ?? firstToday.groups?.name ?? '' }) : t('noMoreToday')}</span>
              </div>
            </div>
          </div>

          <Link href={`/teacher/homework${q ? `?${q}` : ''}`} className="card hw-tile">
            <span>
              <strong>{t('hwToCheck')}</strong>
              <span className="muted" style={{ display: 'block', fontSize: 13 }}>{t('hwToCheckHint')}</span>
            </span>
            <span className="hw-count">{homeworkCount}</span>
          </Link>

          {showPay && <div className="card">
            <h2 style={{ marginTop: 0 }}>{t('myPay', { month: fmtMonth(month, profile.locale) })}</h2>
            {who.pending ? (
              <p className="muted" style={{ margin: 0 }}>{t('payAfterSignIn', { name: who.name })}</p>
            ) : (
              <>
                <div className="big" style={{ color: 'var(--red)' }}>{fmtMoney(payRow?.total ?? 0)}</div>
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
          </div>}

          {(groups.data ?? []).length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('myGroups')}</h2>
              {groups.data!.map((g) => (
                <Link key={g.id} href={`/groups/${g.id}`} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--sand)', color: 'var(--ink)', textDecoration: 'none' }}>
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{g.lessons_done}/{g.lessons_total} · {g.members}</span>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
