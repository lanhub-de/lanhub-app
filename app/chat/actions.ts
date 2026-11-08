'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { notifyNewMessage } from '@/lib/notify';

export type SentMessage = {
  id: string; conversation_id: string; sender_id: string; body: string | null;
  file_path: string | null; file_kind: string | null; file_name: string | null; created_at: string;
};

// Sends a message (the file, if any, is already uploaded by the browser) and
// notifies the others in the background.
export async function sendMessage(input: {
  conversationId: string; body?: string; filePath?: string; fileKind?: 'image' | 'audio' | 'file'; fileName?: string;
}): Promise<{ message?: SentMessage; error?: string }> {
  const supabase = await supabaseServer();
  const body = (input.body ?? '').trim().slice(0, 4000) || null;
  if (!body && !input.filePath) return { error: 'empty' };
  const { data, error } = await supabase.from('messages').insert({
    conversation_id: input.conversationId,
    body,
    file_path: input.filePath ?? null,
    file_kind: input.filePath ? input.fileKind ?? 'file' : null,
    file_name: input.filePath ? (input.fileName ?? 'file').slice(0, 200) : null,
  }).select('id, conversation_id, sender_id, body, file_path, file_kind, file_name, created_at').single();
  if (error || !data) return { error: error?.message ?? 'not sent' };

  const [{ data: me }, { data: chat }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', data.sender_id).maybeSingle(),
    supabase.from('conversations').select('kind, groups(name)').eq('id', input.conversationId)
      .maybeSingle<{ kind: string; groups: { name: string } | null }>(),
  ]);
  const text = body ?? (input.fileKind === 'audio' ? '🎤' : input.fileKind === 'image' ? '📷' : `📎 ${input.fileName ?? ''}`);
  // wait a little for the notifications, but never hold the sender up for long
  await Promise.race([
    notifyNewMessage(supabase, data.id, {
      from: me?.full_name ?? 'LanHub',
      chat: chat?.kind === 'group' ? chat.groups?.name ?? '' : '',
      text,
      path: `/chat?c=${input.conversationId}`,
    }).catch(() => {}),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  return { message: data as SentMessage };
}

export async function deleteMessage(id: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('messages').delete().eq('id', id);
  return error ? { error: error.message } : {};
}

export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not signed in' };
  const { error } = await supabase.from('push_subscriptions')
    .upsert({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, profile_id: user.id });
  return error ? { error: error.message } : {};
}

// Start a chat from a form: with a student (teacher or school), or a group's chat.
export async function openChat(f: FormData) {
  const supabase = await supabaseServer();
  const kind = String(f.get('kind') ?? '');
  const student = String(f.get('student_id') ?? '') || null;
  const teacher = String(f.get('teacher_id') ?? '') || null;
  const group = String(f.get('group_id') ?? '') || null;
  const { data, error } = await supabase.rpc('start_chat', {
    p_kind: kind, p_group: group, p_student: student, p_teacher: teacher,
  });
  if (error) redirect(`/chat?e=${encodeURIComponent(error.message)}`);
  redirect(`/chat?c=${data}`);
}

// A quick message from the student's home to her teacher: opens the direct
// chat first if there is none yet.
export async function sendToTeacher(input: { conversationId?: string | null; studentId: string; teacherId: string; body: string }): Promise<{ error?: string; conversationId?: string }> {
  let cid = input.conversationId ?? null;
  if (!cid) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc('start_chat', {
      p_kind: 'direct', p_group: null, p_student: input.studentId, p_teacher: input.teacherId,
    });
    if (error || !data) return { error: error?.message ?? 'no chat' };
    cid = data as string;
  }
  const res = await sendMessage({ conversationId: cid, body: input.body });
  return res.error ? { error: res.error } : { conversationId: cid };
}
