// Embeds name their foreign key: lesson_absences links lessons and students too,
// so a bare students(...) from lessons is ambiguous for the API (HTTP 300).
import type { LessonView } from '@/components/LessonRow';

export const LESSON_SELECT =
  'id, starts_at, status, kind, zoom_url, teacher_id, group_id, student_id, recording_url, homework_url, note, homework_text, students!lessons_student_id_fkey(full_name, level, zoom_url), groups!lessons_group_id_fkey(name, level, tz, zoom_url), profiles!lessons_teacher_id_fkey(full_name), pending_teacher, invites!lessons_pending_teacher_fkey(full_name), program_lessons(n, title, topic, homework_url, vocab_url, slides_url, teacher_note), lesson_pay!lesson_pay_lesson_id_fkey(amount)';

export type ProgramLessonInfo = {
  n: number; title: string; topic: string | null; homework_url: string | null; vocab_url: string | null;
  slides_url: string | null; teacher_note: string | null;
};

export type LessonDb = {
  id: string; starts_at: string; status: string; kind: string; zoom_url: string | null; teacher_id: string;
  group_id?: string | null; student_id?: string | null; recording_url?: string | null; homework_url?: string | null;
  note?: string | null; homework_text?: string | null;
  program_lessons?: ProgramLessonInfo | null;
  students: { full_name: string; level: string | null; zoom_url?: string | null } | null;
  groups: { name: string; level: string | null; tz?: string; zoom_url?: string | null } | null;
  profiles?: { full_name: string } | null;
  pending_teacher?: string | null;
  lesson_pay?: { amount: number } | null;
  invites?: { full_name: string } | null;
};

// pendingLabel marks a lesson that waits for an invited teacher.
export function toView(l: LessonDb, withTeacher = false, pendingLabel = ''): LessonView {
  return {
    id: l.id, starts_at: l.starts_at, status: l.status, kind: l.kind, zoom_url: l.zoom_url,
    who: l.students?.full_name ?? l.groups?.name ?? '',
    level: l.students?.level ?? l.groups?.level ?? null,
    teacher_name: !withTeacher ? undefined
      : l.pending_teacher ? `${l.invites?.full_name ?? l.pending_teacher}${pendingLabel ? ` · ${pendingLabel}` : ''}`
        : l.profiles?.full_name,
  };
}

// The Zoom link a lesson actually uses: its own, else the student's regular
// link, else the group's, else the teacher's own room (same order as lesson_zoom).
export function zoomOf(l: LessonDb, teacherZoom?: string | null) {
  return l.zoom_url ?? l.students?.zoom_url ?? l.groups?.zoom_url ?? teacherZoom ?? null;
}
