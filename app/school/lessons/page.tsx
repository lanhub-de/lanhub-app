import Shell, { Flash } from '@/components/Shell';
import LessonRow from '@/components/LessonRow';
import { requireProfile, STAFF } from '@/lib/session';
import { currentMonthStart, fmtMonth } from '@/lib/i18n';
import { LESSON_SELECT, toView, type LessonDb } from '@/lib/lessons';
import { addLesson } from '@/app/teacher/actions';

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600e3).toISOString();
  const end = new Date(Date.UTC(y, m, 1) - 3 * 3600e3).toISOString();
  return { start, end };
}

export default async function LessonsPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; month?: string; teacher?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? '') ? sp.month! : currentMonthStart();
  const { start, end } = monthRange(month);

  let q = supabase.from('lessons').select(LESSON_SELECT).gte('starts_at', start).lt('starts_at', end)
    .order('starts_at', { ascending: false }).limit(300);
  if (sp.teacher) q = q.eq('teacher_id', sp.teacher);
  const [lessons, teachers, students, groups] = await Promise.all([
    q.returns<LessonDb[]>(),
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher', 'owner']).eq('active', true).order('full_name'),
    supabase.from('students').select('id, full_name, level').eq('status', 'active').order('full_name'),
    supabase.from('groups').select('id, name').eq('active', true).order('name'),
  ]);

  const months: string[] = [];
  const now = new Date(currentMonthStart() + 'T00:00:00Z');
  for (let i = -1; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  const returnTo = `/school/lessons?month=${month}${sp.teacher ? `&teacher=${sp.teacher}` : ''}`;

  return (
    <Shell profile={profile} t={t} active="/school/lessons">
      <h1>{t('journal')}</h1>
      <Flash error={sp.e} />
      <form className="row" style={{ marginBottom: 16 }}>
        <select name="month" defaultValue={month} aria-label={t('month')}>
          {months.map((m) => <option key={m} value={m}>{fmtMonth(m, profile.locale)}</option>)}
        </select>
        <select name="teacher" defaultValue={sp.teacher ?? ''} aria-label={t('teacher')}>
          <option value="">{t('allTeachers')}</option>
          {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <button type="submit">OK</button>
      </form>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary>+ {t('addLesson')}</summary>
        <form action={addLesson} className="form" style={{ marginTop: 12 }}>
          <input type="hidden" name="return_to" value={returnTo} />
          <label>{t('teacher')}
            <select name="teacher_id" required defaultValue={sp.teacher ?? ''}>
              <option value="" disabled>…</option>
              {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label>{t('whoWith')}
            <select name="who" required defaultValue="">
              <option value="" disabled>…</option>
              {(students.data ?? []).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.full_name}{s.level ? ` · ${s.level}` : ''}</option>)}
              {(groups.data ?? []).map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
            </select>
          </label>
          <label>{t('status')}
            <select name="kind" defaultValue="individual">
              {['individual', 'trial', 'diagnostic'].map((k) => <option key={k} value={k}>{t(`kind_${k}` as never)}</option>)}
            </select>
          </label>
          <label>{t('date')} · {t('time')}<input type="datetime-local" name="starts_at" required /></label>
          <label>{t('zoomLink')}<input type="url" name="zoom_url" /></label>
          <button className="primary" type="submit">{t('add')}</button>
        </form>
      </details>

      <div className="stack">
        {(lessons.data ?? []).length === 0 && <p className="muted">{t('nothingHere')}</p>}
        {(lessons.data ?? []).map((l) => (
          <LessonRow key={l.id} lesson={toView(l, true)} t={t} locale={profile.locale} returnTo={returnTo} canMark />
        ))}
      </div>
    </Shell>
  );
}
