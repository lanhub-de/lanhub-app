'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Labels = { title: string; level: string; file: string; upload: string; library: string };

// Uploads a PDF straight to private storage and records it. The owner and
// head teacher publish to the school library; a teacher's upload stays theirs.
export default function UploadForm({ userId, canPublish, labels }: { userId: string; canPublish: boolean; labels: Labels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('file') as File | null;
    if (!file || file.size === 0) return;
    setBusy(true);
    setError('');
    const supabase = supabaseBrowser();
    const id = crypto.randomUUID();
    const toLibrary = canPublish && form.get('to_library') === 'on';
    const path = toLibrary ? `library/${id}.pdf` : `private/${userId}/${id}.pdf`;
    const up = await supabase.storage.from('files').upload(path, file, { contentType: 'application/pdf' });
    if (up.error) { setBusy(false); setError(up.error.message); return; }
    const { error } = await supabase.from('files').insert({
      id,
      title: String(form.get('title') || file.name.replace(/\.pdf$/i, '')),
      level: String(form.get('level') || '') || null,
      storage_path: path,
      visibility: toLibrary ? 'library' : 'private',
      uploaded_by: userId,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>{labels.file}<input type="file" name="file" accept="application/pdf" required /></label>
      <label>{labels.title}<input name="title" /></label>
      <label>{labels.level}<input name="level" placeholder="A2, B1…" /></label>
      {canPublish && (
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" name="to_library" defaultChecked style={{ minHeight: 0 }} /> {labels.library}
        </label>
      )}
      {error && <div className="flash" role="alert">{error}</div>}
      <button className="primary" type="submit" disabled={busy}>{labels.upload}</button>
    </form>
  );
}
