'use client';
import { useEffect, useState } from 'react';

// Records a voice message in the browser: Opus in WebM where supported,
// AAC in MP4 on Safari. stop(true) hands the recording to onDone.
export function useRecorder(onDone: (blob: Blob, name: string) => void, onError: () => void) {
  const [rec, setRec] = useState<{ start: number; recorder: MediaRecorder; chunks: Blob[] } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [rec]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, voiceOptions());
      const chunks: Blob[] = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      recorder.start();
      setRec({ start: Date.now(), recorder, chunks });
    } catch {
      onError();
    }
  }

  function stop(keep: boolean) {
    if (!rec) return;
    const { recorder, chunks } = rec;
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (!keep || !chunks.length) return;
      const type = recorder.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : 'webm';
      onDone(new Blob(chunks, { type }), `voice-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`);
    };
    recorder.stop();
    setRec(null);
  }

  const seconds = rec ? Math.floor((Date.now() - rec.start) / 1000) : 0;
  return { recording: Boolean(rec), seconds, start, stop };
}

// Speech needs little: Opus at 32 kbps is clear and takes ~240 KB a minute
// (browsers default to ~128 kbps). Safari's AAC gets 64 kbps.
export function voiceOptions(): MediaRecorderOptions {
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
  const audioBitsPerSecond = type.includes('mp4') ? 64000 : 32000;
  return type ? { mimeType: type, audioBitsPerSecond } : { audioBitsPerSecond };
}

export const fmtSeconds =(s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function kindOf(type: string): 'image' | 'audio' | 'file' {
  return type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : 'file';
}

export function extOf(name: string) {
  return (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
}
