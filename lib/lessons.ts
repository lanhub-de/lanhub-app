// Embeds name their foreign key: lesson_absences links lessons and students too,
// so a bare students(...) from lessons is ambiguous for the API (HTTP 300).
import type { LessonView } from '@/components/LessonRow';

export const LESSON_SELECT =
  'id, starts_at, status, kind, zoom_url, teacher_id, group_id, student_id, recording_url, homework_url, note, homework_text, students!lessons_student_id_fkey(full_name, level, zoom_url), groups!lessons_group_id_fkey(name, level, tz, zoom_url), profiles!lessons_teacher_id_fkey(full_name), pending_teacher, invites!lessons_pending_teacher_fkey(full_name), program_lessons(n, title, topic, homework_url, vocab_url, slides_url, teacher_note), lesson_pay!lesson_pay_lesson_id_fkey(amount), created_by, created_at, lesson_moves(from_at, day_changed, late, moved_at)';

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
  created_by?: string | null;
  created_at?: string;
  lesson_moves?: LessonMove[] | null;
};

export type LessonMove = { from_at: string; day_changed: boolean; late: boolean; moved_at: string };

// The move the school should see: the latest one to another day.
export function lastDayMove(l: Pick<LessonDb, 'lesson_moves'>) {
  const moves = (l.lesson_moves ?? []).filter((m) => m.day_changed).sort((a, b) => a.moved_at.localeCompare(b.moved_at));
  const last = moves.at(-1);
  return last ? { from: last.from_at, late: moves.some((m) => m.late) } : null;
}

// A teacher may delete her own booking before it starts, within a day of booking it.
export function canDeleteBooking(l: Pick<LessonDb, 'status' | 'starts_at' | 'created_by' | 'created_at'>, userId?: string) {
  if (!userId || l.status !== 'scheduled' || l.created_by !== userId || !l.created_at) return false;
  const now = Date.now();
  return new Date(l.starts_at).getTime() > now && now - new Date(l.created_at).getTime() < 24 * 3600e3;
}

// pendingLabel marks a lesson that waits for an invited teacher.
export function toView(l: LessonDb, withTeacher = false, pendingLabel = ''): LessonView {
  return {
    id: l.id, starts_at: l.starts_at, status: l.status, kind: l.kind, zoom_url: l.zoom_url,
    who: l.students?.full_name ?? l.groups?.name ?? '',
    level: l.students?.level ?? l.groups?.level ?? null,
    teacher_name: !withTeacher ? undefined
      : l.pending_teacher ? `${l.invites?.full_name ?? l.pending_teacher}${pendingLabel ? ` · ${pendingLabel}` : ''}`
        : l.profiles?.full_name,
    moved: lastDayMove(l),
  };
}

// The Zoom link a lesson actually uses: its own, else the student's regular
// link, else the group's, else the teacher's own room (same order as lesson_zoom).
export function zoomOf(l: LessonDb, teacherZoom?: string | null) {
  return l.zoom_url ?? l.students?.zoom_url ?? l.groups?.zoom_url ?? teacherZoom ?? null;
}
