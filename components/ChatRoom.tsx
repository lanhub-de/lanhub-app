'use client';
import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { deleteMessage, sendMessage, type SentMessage } from '@/app/chat/actions';

export type ChatMessage = SentMessage & { url?: string | null };
type Person = { name: string; role: string };
export type ChatLabels = {
  placeholder: string; send: string; attach: string; voice: string; recording: string; cancel: string;
  you: string; empty: string; tooBig: string; failed: string; noMic: string; remove: string; today: string;
};

const MAX = 25 * 1024 * 1024;

function timeOf(iso: string, locale: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

// One chat: messages arrive live, the composer sends text, files, photos and
// voice messages. Files go straight from the browser to private storage.
export default function ChatRoom({
  cid, me, people, initial, labels, locale, showNames, notice,
}: {
  cid: string; me: string; people: Record<string, Person>; initial: ChatMessage[]; labels: ChatLabels;
  locale: string; showNames: boolean; notice?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rec, setRec] = useState<{ start: number; recorder: MediaRecorder; chunks: Blob[] } | null>(null);
  const [tick, setTick] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const known = useRef(new Set(initial.map((m) => m.id)));

  const add = (m: ChatMessage) => {
    if (known.current.has(m.id)) return;
    known.current.add(m.id);
    setMessages((xs) => [...xs, m]);
  };

  // live updates and "read"
  useEffect(() => {
    const sb = supabaseBrowser();
    let gone = false;
    const markRead = () => { if (document.visibilityState === 'visible') void sb.rpc('mark_chat_read', { cid }); };
    markRead();
    const channel = sb.channel(`chat-${cid}`);
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) sb.realtime.setAuth(data.session.access_token);
      if (gone) return;
      channel.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${cid}` },
        async (payload) => {
          const m = payload.new as ChatMessage;
          if (m.file_path) {
            const { data: signed } = await sb.storage.from('chat').createSignedUrl(m.file_path, 3600);
            m.url = signed?.signedUrl ?? null;
          }
          add(m);
          markRead();
        }).subscribe();
    })();
    document.addEventListener('visibilitychange', markRead);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', markRead);
      void sb.removeChannel(channel);
    };
  }, [cid]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [rec]);

  async function post(input: Parameters<typeof sendMessage>[0], localUrl?: string) {
    const res = await sendMessage(input);
    if (res.error || !res.message) { setError(labels.failed); return false; }
    add({ ...res.message, url: localUrl ?? null });
    return true;
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError('');
    if (await post({ conversationId: cid, body })) setText('');
    setBusy(false);
  }

  async function upload(blob: Blob, name: string, kind: 'image' | 'audio' | 'file') {
    if (blob.size > MAX) { setError(labels.tooBig); return; }
    setBusy(true); setError('');
    const sb = supabaseBrowser();
    const ext = (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
    const path = `${cid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await sb.storage.from('chat').upload(path, blob, { contentType: blob.type || undefined });
    if (upErr) { setError(labels.failed); setBusy(false); return; }
    await post({ conversationId: cid, filePath: path, fileKind: kind, fileName: name, body: text.trim() || undefined },
      URL.createObjectURL(blob));
    setText('');
    setBusy(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'file';
    await upload(f, f.name, kind);
  }

  async function startVoice() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      recorder.start();
      setRec({ start: Date.now(), recorder, chunks });
    } catch {
      setError(labels.noMic);
    }
  }

  function stopVoice(send: boolean) {
    if (!rec) return;
    const { recorder, chunks } = rec;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (!send || !chunks.length) return;
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      const ext = type.includes('mp4') ? 'm4a' : 'webm';
      await upload(blob, `voice-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, 'audio');
    };
    recorder.stop();
    setRec(null);
  }

  async function remove(id: string) {
    const res = await deleteMessage(id);
    if (!res.error) setMessages((xs) => xs.filter((m) => m.id !== id));
  }

  const seconds = rec ? Math.floor((Date.now() - rec.start) / 1000) : 0;
  void tick;

  return (
    <div className="chat-room">
      {notice && <div className="chat-notice">{notice}</div>}
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: 40 }}>{labels.empty}</p>}
        {messages.map((m, i) => {
          const mine = m.sender_id === me;
          const who = people[m.sender_id];
          const prev = messages[i - 1];
          const firstOfRun = !prev || prev.sender_id !== m.sender_id;
          const recent = Date.now() - new Date(m.created_at).getTime() < 3600e3;
          return (
            <div key={m.id} className={`bubble-row ${mine ? 'mine' : ''}`}>
              <div className={`bubble ${mine ? 'mine' : ''}`}>
                {showNames && !mine && firstOfRun && (
                  <div className={`bubble-who ${who?.role !== 'student' ? 'staff' : ''}`}>{who?.name ?? '…'}</div>
                )}
                {m.file_kind === 'image' && m.url && (
                  <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.file_name ?? ''} className="bubble-img" /></a>
                )}
                {m.file_kind === 'audio' && m.url && <audio controls preload="metadata" src={m.url} className="bubble-audio" />}
                {m.file_kind === 'file' && m.url && (
                  <a href={m.url} target="_blank" rel="noreferrer" className="bubble-file">📎 {m.file_name}</a>
                )}
                {m.body && <div className="bubble-text">{m.body}</div>}
                <div className="bubble-meta">
                  {timeOf(m.created_at, locale)}
                  {mine && recent && (
                    <button type="button" className="bubble-del" onClick={() => remove(m.id)} aria-label={labels.remove} title={labels.remove}>×</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {error && <div className="flash" role="alert" style={{ margin: '8px 0 0' }}>{error}</div>}
      {rec ? (
        <div className="chat-compose recording">
          <span className="rec-dot" aria-hidden="true" />
          <span style={{ flex: 1 }}>{labels.recording} {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
          <button type="button" onClick={() => stopVoice(false)}>{labels.cancel}</button>
          <button type="button" className="primary" onClick={() => stopVoice(true)}>{labels.send}</button>
        </div>
      ) : (
        <form className="chat-compose" onSubmit={submit}>
          <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} disabled={busy} aria-label={labels.attach} title={labels.attach}>📎</button>
          <input ref={fileInput} type="file" hidden onChange={onFile}
            accept="image/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.goodnotes" />
          <textarea
            value={text} rows={1} placeholder={labels.placeholder} aria-label={labels.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
          />
          {text.trim() ? (
            <button type="submit" className="primary" disabled={busy}>{labels.send}</button>
          ) : (
            <button type="button" className="icon-btn" onClick={startVoice} disabled={busy} aria-label={labels.voice} title={labels.voice}>🎤</button>
          )}
        </form>
      )}
    </div>
  );
}
