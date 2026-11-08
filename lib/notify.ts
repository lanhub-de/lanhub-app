import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendChatNotice } from './mail';

type Target = {
  profile_id: string; full_name: string; email: string; locale: string;
  endpoint: string | null; p256dh: string | null; auth: string | null; send_email: boolean;
};

let ready = false;
function setup() {
  if (ready) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails('mailto:info@lanhub.academy', pub, priv);
  ready = true;
  return true;
}

// Tells everyone in the chat but the sender about a new message: a push to
// each of their phones and computers, and an email to those without
// notifications (the database keeps that to one email per chat every 6 hours).
export async function notifyNewMessage(
  supabase: SupabaseClient, messageId: string,
  m: { from: string; chat: string; text: string; path: string },
) {
  const secret = process.env.CHAT_SECRET;
  if (!secret) return;
  const { data, error } = await supabase.rpc('chat_notify_targets', { mid: messageId, secret });
  if (error || !data) return;
  const targets = data as Target[];
  const pushOn = setup();
  const snippet = m.text.length > 140 ? `${m.text.slice(0, 137)}…` : m.text;
  const payload = JSON.stringify({
    title: m.chat ? `${m.from} · ${m.chat}` : m.from,
    body: snippet,
    url: m.path,
    tag: m.path,
  });

  const jobs: Promise<unknown>[] = [];
  const emailed = new Set<string>();
  for (const t of targets) {
    if (pushOn && t.endpoint && t.p256dh && t.auth) {
      jobs.push(
        webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 60 * 60 * 24 })
          .catch(async (e: { statusCode?: number }) => {
            // the browser was reset or notifications were switched off
            if (e?.statusCode === 404 || e?.statusCode === 410) {
              await supabase.rpc('drop_push_subscription', { p_endpoint: t.endpoint, secret });
            }
          }),
      );
    }
    if (t.send_email && !emailed.has(t.profile_id)) {
      emailed.add(t.profile_id);
      jobs.push(sendChatNotice(t.email, t.full_name, t.locale, m.from, m.chat, snippet, m.path));
    }
  }
  await Promise.allSettled(jobs);
}
