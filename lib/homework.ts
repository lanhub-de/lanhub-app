import type { SupabaseClient } from '@supabase/supabase-js';
import type { T } from './i18n';
import type { HwLabels } from '@/components/HomeworkForm';
import type { DropLabels } from '@/components/HomeworkDrop';

export type Homework = {
  id: string; lesson_id: string; student_id: string; body: string | null;
  file_path: string | null; file_kind: string | null; file_name: string | null; submitted_at: string;
  status: 'submitted' | 'checked'; feedback: string | null;
  feedback_file_path: string | null; feedback_file_kind: string | null; feedback_file_name: string | null;
  checked_at: string | null;
  file_url?: string | null; feedback_url?: string | null;
};

export const HOMEWORK_COLUMNS =
  'id, lesson_id, student_id, body, file_path, file_kind, file_name, submitted_at, status, feedback, feedback_file_path, feedback_file_kind, feedback_file_name, checked_at';

// Adds one-hour links to the hand-in's file and the teacher's file.
export async function withFileLinks<H extends Homework>(supabase: SupabaseClient, rows: H[]): Promise<H[]> {
  const paths = rows.flatMap((h) => [h.file_path, h.feedback_file_path]).filter(Boolean) as string[];
  if (!paths.length) return rows;
  const { data } = await supabase.storage.from('homework').createSignedUrls(paths, 3600);
  const url = new Map((data ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((h) => ({
    ...h,
    file_url: h.file_path ? url.get(h.file_path) ?? null : null,
    feedback_url: h.feedback_file_path ? url.get(h.feedback_file_path) ?? null : null,
  }));
}

export function homeworkLabels(t: T, mode: 'submit' | 'review'): HwLabels {
  return {
    placeholder: t(mode === 'submit' ? 'hwPlaceholder' : 'hwFeedbackPlaceholder'),
    attach: t('chatAttach'), voice: t('chatVoice'), recording: t('chatRecording'), cancel: t('cancel'),
    send: t(mode === 'submit' ? 'hwSend' : 'hwMarkChecked'), tooBig: t('chatTooBig'), failed: t('chatFailed'),
    noMic: t('chatNoMic'), attached: t('hwAttached'), remove: t('remove'),
  };
}

export function dropLabels(t: T): DropLabels {
  return {
    hint: t('hwDropHint'), choose: t('hwChoose'), sending: t('hwSending'), write: t('hwWrite'), voice: t('chatVoice'),
    placeholder: t('hwPlaceholder'), send: t('send'), recording: t('chatRecording'), cancel: t('cancel'),
    failed: t('chatFailed'), tooBig: t('chatTooBig'), noMic: t('chatNoMic'),
  };
}
