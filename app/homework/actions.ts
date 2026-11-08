'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { sendMessage } from '@/app/chat/actions';

type FileIn = { filePath?: string; fileKind?: 'image' | 'audio' | 'file'; fileName?: string };
type Notice = { teacher_id: string; student_id: string; waiting: boolean; label: string; group_name: string | null };

// Tells the other side in their teacher–student chat, so the usual
// notifications (push or email) carry it.
async function tell(hid: string, text: (n: Notice) => string) {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc('homework_notice', { hid });
  const n = ((data ?? []) as Notice[])[0];
  if (!n || n.waiting) return;
  const { data: cid } = await supabase.rpc('start_chat', { p_kind: 'direct', p_student: n.student_id, p_teacher: n.teacher_id });
  if (cid) await sendMessage({ conversationId: cid as string, body: text(n) });
}

export async function submitHomework(input: { lessonId: string; body?: string } & FileIn, path?: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('submit_homework', {
    p_lesson: input.lessonId,
    p_body: input.body ?? '',
    p_file_path: input.filePath ?? null,
    p_file_kind: input.fileKind ?? null,
    p_file_name: input.fileName ? input.fileName.slice(0, 200) : null,
  });
  if (error) return { error: error.message };
  await tell(data as string, (n) => `📚 ${n.group_name ? `${n.group_name} · ` : ''}${n.label}: надіслано домашнє / homework handed in`);
  if (path) revalidatePath(path);
  return {};
}

export async function reviewHomework(input: { id: string; feedback?: string } & FileIn, path?: string): Promise<{ error?: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('review_homework', {
    p_id: input.id,
    p_feedback: input.feedback ?? '',
    p_file_path: input.filePath ?? null,
    p_file_kind: input.fileKind ?? null,
    p_file_name: input.fileName ? input.fileName.slice(0, 200) : null,
  });
  if (error) return { error: error.message };
  await tell(input.id, (n) => `✅ ${n.label}: домашнє перевірено / homework checked${input.feedback?.trim() ? `\n\n${input.feedback.trim()}` : ''}`);
  if (path) revalidatePath(path);
  return {};
}
