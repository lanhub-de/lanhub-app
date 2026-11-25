import Link from 'next/link';
import type { T } from '@/lib/i18n';
import { attachLessonFile, detachLessonFile } from '@/app/teacher/actions';
import LessonFileUpload from '@/components/LessonFileUpload';
import Submit from '@/components/Submit';

export type FileRef = { id: string; title: string; level?: string | null; group?: string; audio?: boolean };

// Materials for one lesson: files from the library or the teacher's own.
export default function LessonMaterials({
  lessonId, t, returnTo, materials = [], library = [], userId,
}: { lessonId: string; t: T; returnTo: string; materials?: FileRef[]; library?: FileRef[]; userId?: string }) {
  return (
    <div className="materials">
      <span className="muted" style={{ fontSize: 13 }}>{t('lessonMaterials')}:</span>
      {materials.map((f) => (
        <span key={f.id} className="file-chip">
          <Link href={`/library/${f.id}`}>📄 {f.title}</Link>
          <form action={detachLessonFile}>
            <input type="hidden" name="lesson_id" value={lessonId} />
            <input type="hidden" name="file_id" value={f.id} />
            <input type="hidden" name="return_to" value={returnTo} />
            <Submit ariaLabel={t('remove')} title={t('remove')}>×</Submit>
          </form>
        </span>
      ))}
      {library.length > 0 && (
        <details className="move">
          <summary className="link-btn">+ {t('fromLibrary')}</summary>
          <form action={attachLessonFile} className="move-form">
            <input type="hidden" name="lesson_id" value={lessonId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <select name="file_id" required defaultValue="">
              <option value="" disabled>…</option>
              {[...new Set(library.map((f) => f.group ?? ''))].map((g) => {
                const opts = library.filter((f) => (f.group ?? '') === g && !materials.some((m) => m.id === f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.audio ? '🎧 ' : ''}{f.title}{f.level && !g.includes(f.level) ? ` · ${f.level}` : ''}</option>
                ));
                return g ? <optgroup key={g} label={g}>{opts}</optgroup> : opts;
              })}
            </select>
            <Submit className="primary small">{t('add')}</Submit>
          </form>
        </details>
      )}
      {userId && <LessonFileUpload lessonId={lessonId} userId={userId} label={t('ownFile')} failed={t('chatFailed')} />}
    </div>
  );
}
