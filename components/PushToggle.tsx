'use client';
import { useEffect, useState } from 'react';
import { savePushSubscription } from '@/app/chat/actions';

type Labels = { on: string; hint: string; done: string; denied: string; ios: string };

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// "Switch on notifications" for this phone or computer. On an iPhone this only
// works once LanHub is on the home screen, so it says how.
export default function PushToggle({ labels }: { labels: Labels }) {
  const [state, setState] = useState<'unknown' | 'off' | 'on' | 'denied' | 'unsupported' | 'ios' | 'busy'>('unknown');

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(ios && !standalone ? 'ios' : 'unsupported');
        return;
      }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        // keep the server's copy fresh (it may have been dropped)
        const j = sub.toJSON();
        if (j.keys?.p256dh && j.keys?.auth) await savePushSubscription({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
        setState('on');
      } else {
        setState('off');
      }
    })().catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    setState('busy');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setState('unsupported'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const j = sub.toJSON();
      const res = await savePushSubscription({ endpoint: sub.endpoint, p256dh: j.keys!.p256dh!, auth: j.keys!.auth! });
      setState(res.error ? 'off' : 'on');
    } catch {
      setState('off');
    }
  }

  if (state === 'unknown' || state === 'unsupported') return null;
  if (state === 'on') return <p className="push-note ok">🔔 {labels.done}</p>;
  if (state === 'denied') return <p className="push-note">{labels.denied}</p>;
  if (state === 'ios') return <p className="push-note">{labels.ios}</p>;
  return (
    <div className="push-note">
      <button className="primary small" type="button" onClick={enable} disabled={state === 'busy'}>🔔 {labels.on}</button>
      <span>{labels.hint}</span>
    </div>
  );
}
