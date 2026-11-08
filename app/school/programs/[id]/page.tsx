import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import RichText from '@/components/RichText';
import { requireProfile } from '@/lib/session';
import { isAudio, pathLabel, type Folder } from '@/lib/library';
import { addProgramLesson, attachFile, detachFile, saveProgramLesson, updateProgram } from '@/app/groups/actions';

type PL = {
  id: string; n: number; title: string; topic: string | null; goal: string | null; rule: string | null; prepare: string | null;
  after_note: string | null; connected: string | null; homework_url: string | null; vocab_url: string | null;
  slides_url: string | null; teacher_note: string | null;
};
type FileLink = { file_id: string; for_students: boolean; files: { title: string } | null };

export default async function ProgramPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; open?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher']);
  const { id } = await params;
  const sp = await searchParams;

  const { data: program } = await supabase.from('programs').select('id, title, level, next_program_id').eq('id', id).maybeSingle();
  if (!program) notFound();
  const [lessons, others, library, folderRows, guides] = await Promise.all([
    supabase.from('program_lessons').select('*').eq('program_id', id).order('n').returns<PL[]>(),
    supabase.from('programs').select('id, title').neq('id', id).order('title'),
    supabase.from('files').select('id, title, folder_id, staff_only, mime').eq('visibility', 'library').order('title'),
    supabase.from('library_folders').select('id, name, parent_id').returns<Folder[]>(),
    supabase.from('program_files').select('file_id, for_students, files(title)').eq('program_id', id).returns<FileLink[]>(),
  ]);
  const lessonIds = (lessons.data ?? []).map((l) => l.id);
  const { data: lessonFiles } = lessonIds.length
    ? await supabase.from('program_lesson_files').select('program_lesson_id, file_id, for_students, files(title)')
      .in('program_lesson_id', lessonIds).returns<(FileLink & { program_lesson_id: string })[]>()
    : { data: [] as (FileLink & { program_lesson_id: string })[] };

  // library files by folder; team-only ones can go on a course for teachers only
  const libGroups = (() => {
    const folders = folderRows.data ?? [];
    const m = new Map<string, { id: string; title: string; staff_only: boolean }[]>();
    for (const f of library.data ?? []) {
      if (isAudio(f.mime)) continue;
      const g = pathLabel(folders, f.folder_id) || t('libNoFolder');
      m.set(g, [...(m.get(g) ?? []), f]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'));
  })();
  const attachForm = (lessonId: string | null) => (
    <form action={attachFile} className="row">
      <input type="hidden" name="program_id" value={id} />
      <input type="hidden" name="program_lesson_id" value={lessonId ?? ''} />
      <select name="file_id" required defaultValue="" aria-label={t('attachFile')}>
        <option value="" disabled>{t('attachFile')}</option>
        {libGroups.map(([g, files]) => (
          <optgroup key={g} label={g}>
            {files.map((f) => <option key={f.id} value={f.id}>{f.title}{f.staff_only ? ` · 🔒 ${t('libTeamOnly')}` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <select name="for_students" defaultValue="true" aria-label={t('forStudents')}>
        <option value="true">{t('forStudents')}</option>
        <option value="false">{t('teachersOnly')}</option>
      </select>
      <button className="small" type="submit">{t('add')}</button>
    </form>
  );
  const fileList = (items: FileLink[], lessonId: string | null) => items.map((f) => (
    <div key={f.file_id} className="spread" style={{ padding: '6px 0' }}>
      <Link href={`/library/${f.file_id}`}>{f.files?.title}</Link>
      <span className="row">
        <span className="pill">{f.for_students ? t('forStudents') : t('teachersOnly')}</span>
        <form action={detachFile}>
          <input type="hidden" name="program_id" value={id} />
          <input type="hidden" name="program_lesson_id" value={lessonId ?? ''} />
          <input type="hidden" name="file_id" value={f.file_id} />
          <button className="small" type="submit">{t('remove')}</button>
        </form>
      </span>
    </div>
  ));

  return (
    <Shell profile={profile} t={t} active="/school/groups">
      <p style={{ marginTop: 0 }}><Link href="/school/groups">← {t('navGroups')}</Link></p>
      <h1 style={{ marginBottom: 12 }}>{program.title}</h1>
      <Flash error={sp.e} />

      <div className="split" style={{ marginBottom: 20 }}>
        <form action={updateProgram} className="card form">
          <input type="hidden" name="id" value={id} />
          <label>{t('title')}<input name="title" defaultValue={program.title} required /></label>
          <label>{t('level')}<input name="level" defaultValue={program.level ?? ''} /></label>
          <label>{t('nextProgram')}
            <select name="next_program_id" defaultValue={program.next_program_id ?? ''}>
              <option value="">{t('noneOption')}</option>
              {(others.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <button className="primary" type="submit">{t('save')}</button>
        </form>
        <section className="card">
          <h2>{t('courseGuides')}</h2>
          {fileList(guides.data ?? [], null)}
          {attachForm(null)}
        </section>
      </div>

      <div className="stack">
        {(lessons.data ?? []).map((l) => (
          <details key={l.id} className="card" open={sp.open === l.id}>
            <summary className="spread" style={{ color: 'var(--ink)' }}>
              <span><span style={{ color: 'var(--red)', fontWeight: 700, marginRight: 10 }}>{l.n}</span><strong>{l.title}</strong></span>
              <span className="muted" style={{ fontWeight: 400 }}>{l.topic ?? ''}</span>
            </summary>
            <div className="split" style={{ marginTop: 14 }}>
              <form action={saveProgramLesson} className="stack">
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="program_id" value={id} />
                <div className="form">
                  <label>{t('f_title')}<input name="title" defaultValue={l.title} required /></label>
                  <label>{t('f_topic')}<input name="topic" defaultValue={l.topic ?? ''} /></label>
                </div>
                <label>{t('f_goal')}<textarea name="goal" defaultValue={l.goal ?? ''} /></label>
                <label>{t('f_rule')}<textarea name="rule" rows={8} defaultValue={l.rule ?? ''} /></label>
                <label>{t('f_prepare')}<textarea name="prepare" defaultValue={l.prepare ?? ''} /></label>
                <label>{t('f_after')}<textarea name="after_note" defaultValue={l.after_note ?? ''} /></label>
                <label>{t('f_connected')}<textarea name="connected" defaultValue={l.connected ?? ''} /></label>
                <div className="form">
                  <label>{t('f_homework')}<input name="homework_url" type="url" defaultValue={l.homework_url ?? ''} /></label>
                  <label>{t('f_vocab')}<input name="vocab_url" type="url" defaultValue={l.vocab_url ?? ''} /></label>
                  <label>{t('f_slides')}<input name="slides_url" type="url" defaultValue={l.slides_url ?? ''} /></label>
                </div>
                <label>{t('f_teacher_note')}<textarea name="teacher_note" defaultValue={l.teacher_note ?? ''} /></label>
                <small>{t('formatHint')}</small>
                <div><button className="primary" type="submit">{t('save')}</button></div>
              </form>
              <div className="stack">
                <div className="lesson-preview">
                  {l.goal && <p className="goal">{l.goal}</p>}
                  <RichText text={l.rule} />
                </div>
                <div>
                  <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>{t('files')}</h3>
                  {fileList((lessonFiles ?? []).filter((f) => f.program_lesson_id === l.id), l.id)}
                  {attachForm(l.id)}
                </div>
              </div>
            </div>
          </details>
        ))}
      </div>

      <form action={addProgramLesson} style={{ marginTop: 16 }}>
        <input type="hidden" name="program_id" value={id} />
        <button type="submit">+ {t('addProgramLesson')}</button>
      </form>
    </Shell>
  );
}
