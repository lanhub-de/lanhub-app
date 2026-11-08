'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

// "+ own file": a PDF from the teacher's computer, kept as her private file
// and attached to this lesson (the student can open it, nobody else).
export default function LessonFileUpload({ lessonId, userId, label, failed }: { lessonId: string; userId: string; label: string; failed: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    const sb = supabaseBrowser();
    const id = crypto.randomUUID();
    const path = `private/${userId}/${id}.pdf`;
    const up = await sb.storage.from('files').upload(path, file, { contentType: 'application/pdf' });
    const ins = up.error ? up : await sb.from('files').insert({
      id, title: file.name.replace(/\.pdf$/i, ''), storage_path: path, visibility: 'private', uploaded_by: userId,
    });
    const link = ins.error ? ins : await sb.from('lesson_files').insert({ lesson_id: lessonId, file_id: id });
    setBusy(false);
    if (link.error) { setError(failed); return; }
    router.refresh();
  }

  return (
    <>
      <button type="button" className="link-btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? '…' : `+ ${label}`}
      </button>
      <input ref={input} type="file" accept="application/pdf" hidden onChange={onPick} />
      {error && <span className="muted" role="alert">{error}</span>}
    </>
  );
}
