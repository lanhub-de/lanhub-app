'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

// Unread messages next to "Chats" in the menu. Checks on load, when the tab
// comes back, every half minute, and whenever a message arrives.
export default function ChatBadge() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const { data } = await sb.rpc('my_unread_total');
      if (typeof data === 'number') setN(data);
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 800); };
    void load();
    const every = setInterval(load, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    const channel = sb.channel(`chat-badge-${Math.random().toString(36).slice(2)}`);
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) sb.realtime.setAuth(data.session.access_token);
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, soon).subscribe();
    })();
    return () => {
      clearInterval(every);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void sb.removeChannel(channel);
    };
  }, []);
  if (!n) return null;
  return <span className="badge" aria-label={String(n)}>{n > 99 ? '99+' : n}</span>;
}
