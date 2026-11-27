// The managers' to-do list, worked out from packages, lessons and the
// managers' own marks. Nothing here is stored: a task appears when its moment
// comes and disappears when it is resolved (a new package, a payment, a mark).
import type { SupabaseClient } from '@supabase/supabase-js';

export type TaskKind = 'diagnostic' | 'last' | 'feedback' | 'payment' | 'renewal' | 'nopackage';
export const TASK_ORDER: TaskKind[] = ['diagnostic', 'last', 'feedback', 'payment', 'renewal', 'nopackage'];
export const TASK_COLOR: Record<TaskKind | 'ends', string> = {
  diagnostic: '#6b3fa0', last: '#a30000', feedback: '#1f5fa8', payment: '#b06100', renewal: '#8a817a', nopackage: '#1f1a17', ends: '#8a817a',
};

// Why a student does not continue after a package / does not buy after a diagnostic.
export const WHY_RENEWAL = ['price', 'time', 'teacher', 'format', 'goal', 'moved', 'no_reply', 'other'] as const;
export const WHY_DIAGNOSTIC = ['price', 'schedule', 'group', 'no_reply', 'not_taken', 'other'] as const;

// "Wrote to her" hides a task for this many days; if nothing has changed by then it comes back.
export const REMIND_DAYS = 3;

export type Pkg = {
  package_id: string; student_id: string; lessons_total: number; lessons_used: number | string; lessons_left: number | string;
  valid_until: string | null; status: string; paid_lessons: number | null; created_at: string;
};
export type Stu = {
  id: string; full_name: string; level: string | null; teacher_id: string | null; pending_teacher: string | null;
  status: string; left_reason: string | null; created_at: string;
};
export type Les = {
  id: string; student_id: string | null; teacher_id: string; kind: string; status: string; starts_at: string; duration_min: number;
  package_id: string | null;
};
export type Mark = { kind: string; ref: string; remind_at: string | null };

export type Task = {
  kind: TaskKind; ref: string; student: Stu; teacherId: string | null; pkg?: Pkg;
  used?: number; total?: number; left?: number; paid?: number | null;
  next?: string | null; planned?: number; uncovered?: number; lesson?: Les; ended?: string | null; expired?: boolean;
};
export type CalEvent = { day: string; kind: TaskKind | 'ends'; student: Stu; at: string };

const units = (min: number) => Math.round(((min || 60) / 60) * 100) / 100;
const num = (v: number | string | null | undefined) => Number(v ?? 0);
export const kyivDay = (iso: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// Everything the to-do list needs, in one go. Pay is never read here.
export async function loadManagerData(supabase: SupabaseClient) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const until = new Date(Date.now() + 45 * 864e5).toISOString();
  const [students, packages, upcoming, uncovered, diagnostics, marks, people, groups, members] = await Promise.all([
    supabase.from('students').select('id, full_name, level, teacher_id, pending_teacher, status, left_reason, created_at').order('full_name').returns<Stu[]>(),
    supabase.from('package_usage').select('package_id, student_id, lessons_total, lessons_used, lessons_left, valid_until, status, paid_lessons, created_at')
      .order('created_at').returns<Pkg[]>(),
    supabase.from('lessons').select('id, student_id, teacher_id, kind, status, starts_at, duration_min, package_id')
      .not('student_id', 'is', null).eq('status', 'scheduled').gte('starts_at', new Date(Date.now() - 3 * 3600e3).toISOString()).lte('starts_at', until)
      .order('starts_at').returns<Les[]>(),
    supabase.from('lessons').select('id, student_id, teacher_id, kind, status, starts_at, duration_min, package_id')
      .eq('kind', 'individual').is('package_id', null).in('status', ['done', 'no_show', 'late_cancel']).not('student_id', 'is', null).returns<Les[]>(),
    supabase.from('lessons').select('id, student_id, teacher_id, kind, status, starts_at, duration_min, package_id')
      .eq('kind', 'diagnostic').gte('starts_at', since).order('starts_at').returns<Les[]>(),
    supabase.from('manager_marks').select('kind, ref, remind_at').returns<Mark[]>(),
    supabase.from('profiles').select('id, full_name, role, active').order('full_name'),
    supabase.from('groups').select('id, name, level, kind, teacher_id, active').eq('active', true).order('name'),
    supabase.from('group_members').select('group_id, student_id'),
  ]);
  return {
    students: students.data ?? [], packages: packages.data ?? [], upcoming: upcoming.data ?? [],
    uncovered: uncovered.data ?? [], diagnostics: diagnostics.data ?? [], marks: marks.data ?? [],
    people: (people.data ?? []) as { id: string; full_name: string; role: string; active: boolean }[],
    groups: (groups.data ?? []) as { id: string; name: string; level: string | null; kind: string; teacher_id: string | null }[],
    members: (members.data ?? []) as { group_id: string; student_id: string }[],
  };
}
export type ManagerData = Awaited<ReturnType<typeof loadManagerData>>;

// The package the next lesson counts from: valid now first, else one past its month with lessons left.
function packagesOf(all: Pkg[]) {
  const by = new Map<string, Pkg[]>();
  for (const p of all) if (p.status !== 'cancelled') by.set(p.student_id, [...(by.get(p.student_id) ?? []), p]);
  return by;
}

export function buildTasks(d: ManagerData, now = new Date()) {
  const hidden = (kind: TaskKind, ref: string) => d.marks.some((m) => m.kind === kind && m.ref === ref
    && (m.remind_at === null || new Date(m.remind_at) > now));
  const pk = packagesOf(d.packages);
  const nextBy = new Map<string, Les[]>();
  for (const l of d.upcoming) if (l.kind === 'individual' && l.student_id) nextBy.set(l.student_id, [...(nextBy.get(l.student_id) ?? []), l]);
  const uncoveredBy = new Map<string, number>();
  for (const l of d.uncovered) if (l.student_id) uncoveredBy.set(l.student_id, (uncoveredBy.get(l.student_id) ?? 0) + 1);
  const stuById = new Map(d.students.map((s) => [s.id, s]));

  const tasks: Task[] = [];
  const events: CalEvent[] = [];

  for (const s of d.students) {
    if (s.status !== 'active') continue;
    const list = pk.get(s.id) ?? [];
    const open = list.filter((p) => (p.status === 'active' || p.status === 'expired') && num(p.lessons_left) > 0);
    const cur = open.find((p) => p.status === 'active') ?? open[0] ?? null;
    const hasNext = cur ? open.some((p) => p !== cur) : false;
    const planned = nextBy.get(s.id) ?? [];
    const next = planned[0]?.starts_at ?? null;
    const base = { student: s, teacherId: s.teacher_id, next, planned: planned.length };

    if (cur) {
      const used = num(cur.lessons_used), total = cur.lessons_total, left = num(cur.lessons_left);
      const info = { ...base, pkg: cur, used, total, left, paid: cur.paid_lessons };
      if (!hasNext && left <= 1 && !hidden('last', cur.package_id)) tasks.push({ kind: 'last', ref: cur.package_id, ...info });
      if (total >= 4 && used >= total / 2 && used < total / 2 + 2 && left > 1 && !hidden('feedback', cur.package_id)) {
        tasks.push({ kind: 'feedback', ref: cur.package_id, ...info });
      }
      if (cur.paid_lessons != null && cur.paid_lessons < total && used >= cur.paid_lessons - 1 && !hidden('payment', cur.package_id)) {
        tasks.push({ kind: 'payment', ref: cur.package_id, ...info });
      }
      // the calendar: which planned lesson is the half, the last paid one, the last one
      let cum = used;
      for (const l of planned) {
        const before = cum;
        cum += units(l.duration_min);
        const day = kyivDay(l.starts_at);
        if (cur.paid_lessons != null && cur.paid_lessons < total && before < cur.paid_lessons && cum >= cur.paid_lessons) events.push({ day, kind: 'payment', student: s, at: l.starts_at });
        if (total >= 4 && before < total / 2 && cum >= total / 2) events.push({ day, kind: 'feedback', student: s, at: l.starts_at });
        if (!hasNext && before < total && cum >= total) { events.push({ day, kind: 'last', student: s, at: l.starts_at }); break; }
      }
      if (cur.status === 'active' && cur.valid_until) events.push({ day: kyivDay(cur.valid_until), kind: 'ends', student: s, at: cur.valid_until });
    }

    // package over (or its month over), nothing new bought
    const anyActive = list.some((p) => p.status === 'active');
    if (list.length > 0 && !anyActive) {
      const latest = list[list.length - 1];
      const ended = list.map((p) => p.valid_until).filter(Boolean).sort().at(-1) ?? null;
      if (!hidden('renewal', latest.package_id)) {
        tasks.push({ kind: 'renewal', ref: latest.package_id, ...base, pkg: cur ?? latest, ended, expired: !!cur, uncovered: uncoveredBy.get(s.id) ?? 0,
          used: cur ? num(cur.lessons_used) : undefined, total: cur?.lessons_total, left: cur ? num(cur.lessons_left) : 0 });
      }
    } else if (!cur && (s.teacher_id || s.pending_teacher) && ((uncoveredBy.get(s.id) ?? 0) > 0 || planned.length > 0)) {
      // lessons with no package to count from
      if (!hidden('nopackage', s.id)) tasks.push({ kind: 'nopackage', ref: s.id, ...base, uncovered: uncoveredBy.get(s.id) ?? 0 });
    }
  }

  // after a diagnostic: offer a package (until one is bought or she says no)
  for (const l of d.diagnostics) {
    const s = l.student_id ? stuById.get(l.student_id) : undefined;
    if (!s) continue;
    if (l.status === 'scheduled' && new Date(l.starts_at) > now) {
      events.push({ day: kyivDay(l.starts_at), kind: 'diagnostic', student: s, at: l.starts_at });
      continue;
    }
    if (l.status !== 'done' || s.status !== 'active') continue;
    const bought = (pk.get(s.id) ?? []).some((p) => new Date(p.created_at).getTime() > new Date(l.starts_at).getTime() - 864e5);
    if (bought || hidden('diagnostic', l.id)) continue;
    tasks.push({ kind: 'diagnostic', ref: l.id, student: s, teacherId: l.teacher_id, lesson: l, next: null });
  }

  tasks.sort((a, b) => TASK_ORDER.indexOf(a.kind) - TASK_ORDER.indexOf(b.kind)
    || String(a.next ?? '9').localeCompare(String(b.next ?? '9')) || a.student.full_name.localeCompare(b.student.full_name));
  return { tasks, events };
}

// What a teacher's student needs now, for the folder table (the first open task).
export function taskFor(tasks: Task[], studentId: string) {
  return tasks.find((t) => t.student.id === studentId) ?? null;
}

// Monday of this week (Kyiv) and the 14 days from it, as YYYY-MM-DD.
export function twoWeeks(now = new Date()) {
  const today = kyivDay(now);
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return {
    today,
    days: Array.from({ length: 14 }, (_, i) => {
      const x = new Date(d); x.setUTCDate(d.getUTCDate() + i);
      return x.toISOString().slice(0, 10);
    }),
  };
}
