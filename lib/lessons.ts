import type { LessonView } from '@/components/LessonRow';

export const LESSON_SELECT =
  'id, starts_at, status, kind, zoom_url, teacher_id, students(full_name, level), groups(name, level), profiles!lessons_teacher_id_fkey(full_name)';

export type LessonDb = {
  id: string; starts_at: string; status: string; kind: string; zoom_url: string | null; teacher_id: string;
  students: { full_name: string; level: string | null } | null;
  groups: { name: string; level: string | null } | null;
  profiles?: { full_name: string } | null;
};

export function toView(l: LessonDb, withTeacher = false): LessonView {
  return {
    id: l.id, starts_at: l.starts_at, status: l.status, kind: l.kind, zoom_url: l.zoom_url,
    who: l.students?.full_name ?? l.groups?.name ?? '',
    level: l.students?.level ?? l.groups?.level ?? null,
    teacher_name: withTeacher ? l.profiles?.full_name : undefined,
  };
}
