import Link from 'next/link';
import Shell from '@/components/Shell';
import ShortDate from '@/components/ShortDate';
import { IconCards, IconFile, IconPen } from '@/components/Icons';
import { requireProfile } from '@/lib/session';

type FileRow = { lesson_id: string; files: { id: string; title: string } | null };

// Everything the student can open: her links, the files from her lessons and
// her group courses' files.
export default async function MyMaterials() {
  const { supabase, profile, t } = await requireProfile(['student']);
  const now = Date.now();
  const [{ data: ids }, { data: groups }] = await Promise.all([supabase.rpc('my_student_ids'), supabase.rpc('my_course_groups')]);
  const studentIds = (ids ?? []) as string[];
  const groupList = (groups ?? []) as { id: string; name: string; program_title: string | null }[];

  const [students, lessonSets, courseSets] = await Promise.all([
    studentIds.length ? supabase.from('students').select('id, goodnotes_url, quizlet_url').in('id', studentIds) : Promise.resolve({ data: [] }),
    Promise.all(studentIds.map((sid) => supabase.rpc('student_lessons', { sid, p_from: new Date(now - 365 * 864e5).toISOString(), p_to: new Date(now + 60 * 864e5).toISOString() }))),
    Promise.all(groupList.map((g) => supabase.rpc('course_files', { gid: g.id }))),
  ]);
  const lessons = lessonSets.flatMap((r) => (r.data ?? []) as { id: string; starts_at: string; note: string | null }[]);
  const lessonOf = new Map(lessons.map((l) => [l.id, l]));
  const { data: lf } = lessons.length
    ? await supabase.from('lesson_files').select('lesson_id, files(id, title)').in('lesson_id', lessons.map((l) => l.id)).returns<FileRow[]>()
    : { data: [] as FileRow[] };
  const seen = new Set<string>();
  const lessonFiles = ((lf ?? []) as FileRow[])
    .filter((f) => f.files && !seen.has(f.files.id) && seen.add(f.files.id))
    .map((f) => ({ ...f.files!, lesson: lessonOf.get(f.lesson_id) }))
    .sort((a, b) => (b.lesson?.starts_at ?? '').localeCompare(a.lesson?.starts_at ?? ''));
  const links = ((students.data ?? []) as { goodnotes_url: string | null; quizlet_url: string | null }[])
    .flatMap((s) => [s.goodnotes_url ? { k: 'g', url: s.goodnotes_url } : null, s.quizlet_url ? { k: 'q', url: s.quizlet_url } : null])
    .filter(Boolean) as { k: string; url: string }[];
  const courses = groupList.map((g, i) => ({ g, files: (courseSets[i]?.data ?? []) as { file_id: string; title: string }[] })).filter((c) => c.files.length);
  const empty = !links.length && !lessonFiles.length && !courses.length;

  return (
    <Shell profile={profile} t={t} active="/me/materials">
      <div className="s-narrow">
        <h1 className="s-title">{t('matTitle')}</h1>
        {empty && <section className="card s-card"><p className="muted" style={{ margin: 0 }}>{t('matEmpty')}</p></section>}
        {links.length > 0 && (
          <section className="card s-card">
            <h2 className="s-h">{t('matLinks')}</h2>
            <div className="s-list">
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="s-row">
                  <span>{l.k === 'g' ? <><IconPen />GoodNotes</> : <><IconCards />Quizlet</>}</span><span className="open-link">{t('open')}</span>
                </a>
              ))}
            </div>
          </section>
        )}
        {lessonFiles.length > 0 && (
          <section className="card s-card">
            <h2 className="s-h">{t('matLessons')}</h2>
            <div className="s-list">
              {lessonFiles.map((f) => (
                <Link key={f.id} href={`/me/files/${f.id}`} className="s-row">
                  <span><IconFile />{f.title}{f.lesson && <span className="muted" style={{ fontSize: 13 }}>· <ShortDate iso={f.lesson.starts_at} locale={profile.locale} /></span>}</span>
                  <span className="open-link">{t('open')}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {courses.map(({ g, files }) => (
          <section key={g.id} className="card s-card">
            <h2 className="s-h">{t('matCourse')} · {g.program_title ?? g.name}</h2>
            <div className="s-list">
              {files.map((f) => (
                <Link key={f.file_id} href={`/me/files/${f.file_id}`} className="s-row">
                  <span><IconFile />{f.title}</span><span className="open-link">{t('open')}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
