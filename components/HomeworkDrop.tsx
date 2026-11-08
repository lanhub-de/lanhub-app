'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { extOf, fmtSeconds, kindOf, useRecorder } from '@/lib/recorder';
import { submitHomework } from '@/app/homework/actions';
import { IconUpload } from '@/components/Icons';

export type DropLabels = {
  hint: string; choose: string; sending: string; write: string; voice: string; placeholder: string;
  send: string; recording: string; cancel: string; failed: string; tooBig: string; noMic: string;
};

const MAX = 25 * 1024 * 1024;

// Handing in homework as in the mockup: drop a file (photo of the notebook,
// PDF, Word) or pick one and it is sent at once. Text or a voice message are
// one tap away under it.
export default function HomeworkDrop({ lessonId, studentId, path, labels }: {
  lessonId: string; studentId: string; path: string; labels: DropLabels;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const rec = useRecorder((blob, name) => void send({ blob, name }), () => setError(labels.noMic));

  async function send(file?: { blob: Blob; name: string }) {
    if (busy || (!file && !text.trim())) return;
    setBusy(true); setError('');
    let fileIn: { filePath?: string; fileKind?: 'image' | 'audio' | 'file'; fileName?: string } = {};
    if (file) {
      if (file.blob.size > MAX) { setError(labels.tooBig); setBusy(false); return; }
      const p = `${lessonId}/${studentId}/${Date.now()}.${extOf(file.name)}`;
      const { error: up } = await supabaseBrowser().storage.from('homework').upload(p, file.blob, { contentType: file.blob.type || undefined });
      if (up) { setError(labels.failed); setBusy(false); return; }
      fileIn = { filePath: p, fileKind: kindOf(file.blob.type), fileName: file.name };
    }
    const res = await submitHomework({ lessonId, body: text, ...fileIn }, path);
    setBusy(false);
    if (res.error) { setError(labels.failed); return; }
    setText(''); setWriting(false);
    router.refresh();
  }

  return (
    <div className="hw-drop-wrap">
      <div
        className={`hw-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void send({ blob: f, name: f.name });
        }}
      >
        <IconUpload />
        <span className="muted">{labels.hint}</span>
        <button type="button" className="primary" onClick={() => input.current?.click()} disabled={busy || rec.recording}>
          {busy ? labels.sending : labels.choose}
        </button>
        <input ref={input} type="file" hidden accept="image/*,audio/*,.pdf,.doc,.docx,.txt,.goodnotes"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send({ blob: f, name: f.name }); }} />
      </div>
      {error && <div className="flash" role="alert" style={{ margin: 0 }}>{error}</div>}
      {rec.recording ? (
        <div className="row" style={{ fontSize: 14 }}>
          <span className="rec-dot" aria-hidden="true" />
          <span>{labels.recording} {fmtSeconds(rec.seconds)}</span>
          <button type="button" className="small" onClick={() => rec.stop(false)}>{labels.cancel}</button>
          <button type="button" className="small primary" onClick={() => rec.stop(true)}>{labels.send}</button>
        </div>
      ) : writing ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={labels.placeholder} aria-label={labels.placeholder} autoFocus />
          <div className="row">
            <button type="button" className="small" onClick={() => { setWriting(false); setText(''); }}>{labels.cancel}</button>
            <button type="button" className="small primary" disabled={busy || !text.trim()} onClick={() => void send()}>{labels.send}</button>
          </div>
        </div>
      ) : (
        <div className="hw-alt">
          <button type="button" className="link-btn" onClick={() => setWriting(true)} disabled={busy}>✏️ {labels.write}</button>
          <button type="button" className="link-btn" onClick={rec.start} disabled={busy}>🎤 {labels.voice}</button>
        </div>
      )}
    </div>
  );
}
