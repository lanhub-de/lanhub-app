'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { extOf, fmtSeconds, kindOf, useRecorder } from '@/lib/recorder';
import { shrinkImage } from '@/lib/compress';
import { reviewHomework, submitHomework } from '@/app/homework/actions';

export type HwLabels = {
  placeholder: string; attach: string; voice: string; recording: string; cancel: string; send: string;
  tooBig: string; failed: string; noMic: string; attached: string; remove: string;
};

const MAX = 25 * 1024 * 1024;

// Text, a file or photo, and/or a voice message, uploaded to private storage
// under <lesson>/<student>/ and handed in (mode "submit") or sent back as the
// teacher's check (mode "review", with the hand-in's id).
export default function HomeworkForm({
  mode, lessonId, studentId, homeworkId, labels, path, initialText = '',
}: {
  mode: 'submit' | 'review'; lessonId: string; studentId: string; homeworkId?: string;
  labels: HwLabels; path: string; initialText?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const rec = useRecorder((blob, name) => setFile({ blob, name }), () => setError(labels.noMic));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (!text.trim() && !file)) return;
    setBusy(true); setError('');
    let fileIn: { filePath?: string; fileKind?: 'image' | 'audio' | 'file'; fileName?: string } = {};
    if (file) {
      const small = await shrinkImage(file);
      if (small.blob.size > MAX) { setError(labels.tooBig); setBusy(false); return; }
      const p = `${lessonId}/${studentId}/${mode === 'review' ? 'check-' : ''}${Date.now()}.${extOf(small.name)}`;
      const { error: up } = await supabaseBrowser().storage.from('homework').upload(p, small.blob, { contentType: small.blob.type || undefined });
      if (up) { setError(labels.failed); setBusy(false); return; }
      fileIn = { filePath: p, fileKind: kindOf(small.blob.type), fileName: small.name };
    }
    const res = mode === 'submit'
      ? await submitHomework({ lessonId, body: text, ...fileIn }, path)
      : await reviewHomework({ id: homeworkId!, feedback: text, ...fileIn }, path);
    setBusy(false);
    if (res.error) { setError(labels.failed); return; }
    setText(''); setFile(null);
    router.refresh();
  }

  return (
    <form className="hw-form" onSubmit={send}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={labels.placeholder} aria-label={labels.placeholder} />
      {file && (
        <div className="hw-attached">
          {kindOf(file.blob.type) === 'audio' ? <audio controls src={URL.createObjectURL(file.blob)} /> : <span>📎 {file.name}</span>}
          <button type="button" className="small" onClick={() => setFile(null)}>{labels.remove}</button>
        </div>
      )}
      {error && <div className="flash" role="alert">{error}</div>}
      <div className="row">
        {rec.recording ? (
          <>
            <span className="rec-dot" aria-hidden="true" />
            <span>{labels.recording} {fmtSeconds(rec.seconds)}</span>
            <button type="button" className="small" onClick={() => rec.stop(false)}>{labels.cancel}</button>
            <button type="button" className="small" onClick={() => rec.stop(true)}>OK</button>
          </>
        ) : (
          <>
            <button type="button" className="small" onClick={() => input.current?.click()} disabled={busy}>📎 {labels.attach}</button>
            <input ref={input} type="file" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (f) setFile({ blob: f, name: f.name });
            }} accept="image/*,audio/*,.pdf,.doc,.docx,.txt,.goodnotes" />
            <button type="button" className="small" onClick={rec.start} disabled={busy}>🎤 {labels.voice}</button>
          </>
        )}
        <button type="submit" className="primary small" disabled={busy || rec.recording || (!text.trim() && !file)} style={{ marginLeft: 'auto' }}>
          {labels.send}
        </button>
      </div>
    </form>
  );
}
