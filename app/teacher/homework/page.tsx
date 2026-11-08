import Link from 'next/link';
import Shell from '@/components/Shell';
import HomeworkForm from '@/components/HomeworkForm';
import HomeworkView from '@/components/HomeworkView';
import { requireProfile, TEACHING } from '@/lib/session';
import { fmtDate, fmtDateTime } from '@/lib/i18n';
import { HOMEWORK_COLUMNS, homeworkLabels, withFileLinks, type Homework } from '@/lib/homework';
import { asParam, CabinetSwitch, whoseCabinet } from '@/lib/cabinet';

type Row = Homework & {
  lessons: { starts_at: string; teacher_id: string; program_lessons: { n: number; title: string } | null; groups: { name: string } | null } | null;
  students: { full_name: string; level: string | null } | null;
};

// Homework handed in to this teacher: the ones to check first, then the
// ones checked lately.
export default async function HomeworkPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const who = await whoseCabinet(supabase, profile, sp.as);
  const q = asParam(who);
  const path = `/teacher/homework${q ? `?${q}` : ''}`;
  const cols = `${HOMEWORK_COLUMNS}, lessons!inner(starts_at, teacher_id, pending_teacher, program_lessons(n, title), groups!lessons_group_id_fkey(name)), students!homework_student_id_fkey(full_name, level)`;
  const base = () => {
    const x = supabase.from('homework').select(cols);
    return who.pending ? x.eq('lessons.pending_teacher', who.pending) : x.eq('lessons.teacher_id', who.id).is('lessons.pending_teacher', null);
  };
  const [open, done] = await Promise.all([
    base().eq('status', 'submitted').order('submitted_at').returns<Row[]>(),
    base().eq('status', 'checked').order('checked_at', { ascending: false }).limit(20).returns<Row[]>(),
  ]);
  const [toCheck, checked] = await Promise.all([
    withFileLinks(supabase, open.data ?? []),
    withFileLinks(supabase, done.data ?? []),
  ]);
  const label = (h: Row) => [
    h.lessons?.groups?.name,
    h.lessons?.program_lessons ? `L${h.lessons.program_lessons.n} · ${h.lessons.program_lessons.title}` : h.lessons ? fmtDateTime(h.lessons.starts_at, profile.locale) : '',
  ].filter(Boolean).join(' · ');

  return (
    <Shell profile={profile} t={t} active="/teacher">
      <CabinetSwitch supabase={supabase} me={profile} who={who} base="/teacher/homework" t={t} />
      <p style={{ marginTop: 0 }}><Link href={`/teacher${q ? `?${q}` : ''}`}>← {t('todayHeading')}</Link></p>
      <h1>{t('hwToCheck')}{who.viewing ? ` · ${who.name}` : ''}</h1>

      <div className="stack">
        {toCheck.length === 0 && <div className="card muted">{t('hwNone')}</div>}
        {toCheck.map((h) => (
          <article key={h.id} className="card stack" style={{ gap: 10 }}>
            <div className="spread">
              <strong>{h.students?.full_name}{h.students?.level ? ` · ${h.students.level}` : ''}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{t('hwSentOn', { date: fmtDate(h.submitted_at, profile.locale) })}</span>
            </div>
            <span className="muted" style={{ fontSize: 14 }}>{label(h)}</span>
            <HomeworkView body={h.body} url={h.file_url} kind={h.file_kind} name={h.file_name} />
            <HomeworkForm mode="review" lessonId={h.lesson_id} studentId={h.student_id} homeworkId={h.id}
              labels={homeworkLabels(t, 'review')} path={path} />
          </article>
        ))}

        {checked.length > 0 && (
          <>
            <h2 style={{ marginTop: 14 }}>{t('hwCheckedRecently')}</h2>
            {checked.map((h) => (
              <details key={h.id} className="card">
                <summary className="spread">
                  <span><strong>{h.students?.full_name}</strong> <span className="muted">· {label(h)}</span></span>
                  <span className="pill ok">{t('hwChecked')}</span>
                </summary>
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <HomeworkView body={h.body} url={h.file_url} kind={h.file_kind} name={h.file_name} />
                  {(h.feedback || h.feedback_url) && (
                    <div className="hw-feedback">
                      <strong>{t('hwTeacherSays')}</strong>
                      <HomeworkView body={h.feedback} url={h.feedback_url} kind={h.feedback_file_kind} name={h.feedback_file_name} />
                    </div>
                  )}
                </div>
              </details>
            ))}
          </>
        )}
      </div>
    </Shell>
  );
}
