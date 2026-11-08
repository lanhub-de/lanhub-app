'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sendToTeacher } from '@/app/chat/actions';
import { IconSend } from '@/components/Icons';

export type PeekMessage = { id: string; mine: boolean; text: string };

// The chat with the teacher on the student's home: the last messages and a
// line to write the next one without leaving the page.
export default function ChatPeek({
  title, messages, conversationId, studentId, teacherId, canWrite, placeholder, sendLabel, openLabel, emptyText, failed, preview,
}: {
  title: string; messages: PeekMessage[]; conversationId: string | null; studentId: string; teacherId: string | null;
  canWrite: boolean; placeholder: string; sendLabel: string; openLabel: string; emptyText: string; failed: string; preview?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<PeekMessage[]>([]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy || !teacherId || preview) return;
    setBusy(true); setError('');
    const res = await sendToTeacher({ conversationId, studentId, teacherId, body });
    setBusy(false);
    if (res.error) { setError(failed); return; }
    setSent((s) => [...s, { id: `local-${Date.now()}`, mine: true, text: body }]);
    setText('');
    router.refresh();
  }

  const all = [...messages, ...sent.filter((s) => !messages.some((m) => m.mine && m.text === s.text))].slice(-4);
  return (
    <section className="card s-card s-chat" aria-label={title}>
      <div className="spread">
        <h2 className="s-h">{title}</h2>
        {conversationId && !preview && <Link href={`/chat?c=${conversationId}`} className="small-link">{openLabel}</Link>}
      </div>
      {all.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{emptyText}</p>}
      {all.map((m) => <div key={m.id} className={`s-bubble ${m.mine ? 'mine' : ''}`}>{m.text}</div>)}
      {canWrite && (
        <form className="s-compose" onSubmit={send}>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder}
            disabled={preview || busy} />
          <button type="submit" className="primary" aria-label={sendLabel} disabled={preview || busy || !text.trim()}><IconSend /></button>
        </form>
      )}
      {error && <div className="flash" role="alert" style={{ margin: 0 }}>{error}</div>}
    </section>
  );
}
