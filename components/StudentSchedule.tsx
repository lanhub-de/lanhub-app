import type { SupabaseClient } from '@supabase/supabase-js';
import ShortDate from '@/components/ShortDate';
import { IconVideo } from '@/components/Icons';
import type { Locale, T } from '@/lib/i18n';
import { withName } from '@/lib/names';

type Row = { id: string; starts_at: string; title: string; sub: string; zoom: string | null };

export type Group = { id: string; name: string; program_title: string | null };

// The student's coming lessons, individual and group, with Zoom. Used on her
// own Schedule tab and in "view as student".
export default async function StudentSchedule({ supabase, studentIds, groupList, t, locale }: {
  supabase: SupabaseClient; studentIds: string[]; groupList: Group[]; t: T; locale: Locale;
}) {
  const now = Date.now();
  const from = new Date(now - 2 * 3600e3).toISOString();
  const to = new Date(now + 60 * 864e5).toISOString();

  const solo = await Promise.all(studentIds.map((sid) => supabase.rpc('student_lessons', { sid, p_from: from, p_to: to })));
  const rows: Row[] = [];
  for (const res of solo) {
    for (const l of (res.data ?? []) as { id: string; starts_at: string; status: string; zoom_url: string | null; note: string | null; teacher_name: string | null }[]) {
      if (l.status !== 'scheduled') continue;
      rows.push({ id: l.id, starts_at: l.starts_at, title: l.note ?? t('kind_individual'), sub: l.teacher_name ? withName(l.teacher_name, locale) : '', zoom: l.zoom_url });
    }
  }
  const grouped = await Promise.all(groupList.map(async (g) => {
    const [head, slots, lessons] = await Promise.all([
      supabase.rpc('course_group', { gid: g.id }), supabase.rpc('course_schedule', { gid: g.id }), supabase.rpc('course_lessons', { gid: g.id }),
    ]);
    return { g, head: ((head.data ?? []) as { zoom_url: string | null; teacher_name: string | null }[])[0], slots: (slots.data ?? []) as { id: string; starts_at: string; status: string; zoom_url: string | null; program_lesson_id: string | null }[], lessons: (lessons.data ?? []) as { id: string; n: number; title: string }[] };
  }));
  for (const { g, head, slots, lessons } of grouped) {
    const pl = new Map(lessons.map((x) => [x.id, x]));
    for (const s of slots) {
      if (s.status !== 'scheduled' || s.starts_at < from || s.starts_at > to) continue;
      const p = s.program_lesson_id ? pl.get(s.program_lesson_id) : undefined;
      rows.push({ id: s.id, starts_at: s.starts_at, title: p ? `${t('c_lesson', { n: p.n })} · ${p.title}` : g.name,
        sub: [g.program_title ?? g.name, head?.teacher_name ? withName(head.teacher_name, locale) : null].filter(Boolean).join(' · '), zoom: s.zoom_url ?? head?.zoom_url ?? null });
    }
  }
  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="s-narrow">
        <h1 className="s-title">{t('schedTitle')}</h1>
        <section className="card s-card">
          {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('schedEmpty')}</p>}
          <div className="s-hist">
            {rows.map((r) => (
              <div key={r.id} className="s-sched-row">
                <span className="s-sched-when tnum"><ShortDate iso={r.starts_at} locale={locale} time /></span>
                <span className="s-sched-what"><strong>{r.title}</strong>{r.sub && <span className="muted">{r.sub}</span>}</span>
                {r.zoom
                  ? <a href={r.zoom} target="_blank" rel="noreferrer" className="btn small"><IconVideo size={16} /> Zoom</a>
                  : <span />}
              </div>
            ))}
          </div>
        </section>
    </div>
  );
}
