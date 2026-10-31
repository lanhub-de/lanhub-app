import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { addGroup, addStudent } from '../actions';

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ e?: string; q?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const [students, teachers, packages, groups] = await Promise.all([
    supabase.from('students').select('id, full_name, level, market, teacher_id, status').order('full_name'),
    supabase.from('profiles').select('id, full_name, role').in('role', ['teacher', 'head_teacher', 'owner']).eq('active', true).order('full_name'),
    supabase.from('package_usage').select('student_id, lessons_left, status'),
    supabase.from('groups').select('id, name, level, kind, teacher_id').eq('active', true).order('name'),
  ]);
  const teacherName = new Map((teachers.data ?? []).map((p) => [p.id, p.full_name]));
  const active = new Map<string, number>();
  for (const p of packages.data ?? []) if (p.status === 'active') active.set(p.student_id, p.lessons_left);
  const q = (sp.q ?? '').toLowerCase();
  const list = (students.data ?? []).filter((s) => !q || s.full_name.toLowerCase().includes(q));

  return (
    <Shell profile={profile} t={t} active="/school/students">
      <div className="spread"><h1>{t('navStudents')}</h1></div>
      <Flash error={sp.e} />

      <details className="card" style={{ marginBottom: 16 }}>
        <summary>+ {t('addStudent')}</summary>
        <form action={addStudent} className="form" style={{ marginTop: 12 }}>
          <label>{t('name')}<input name="full_name" required /></label>
          <label>{t('level')}<input name="level" placeholder="A2, B1…" /></label>
          <label>{t('teacher')}
            <select name="teacher_id" defaultValue="">
              <option value="">…</option>
              {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label>{t('market')}
            <select name="market" defaultValue="ua">
              <option value="ua">{t('market_ua')}</option>
              <option value="intl">{t('market_intl')}</option>
            </select>
          </label>
          <label>{t('emailLabel')}<input type="email" name="email" /></label>
          <label>{t('contact')}<input name="contact" /></label>
          <button className="primary" type="submit">{t('add')}</button>
        </form>
      </details>

      <form className="row" style={{ marginBottom: 12 }}>
        <input name="q" defaultValue={sp.q} placeholder="🔍" aria-label="search" style={{ maxWidth: 280 }} />
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>{t('name')}</th><th>{t('level')}</th><th>{t('teacher')}</th><th>{t('market')}</th><th className="num">{t('packages')}</th></tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/school/students/${s.id}`}>{s.full_name}</Link>{s.status !== 'active' && <span className="muted"> · {s.status}</span>}</td>
                <td>{s.level ?? ''}</td>
                <td>{s.teacher_id ? teacherName.get(s.teacher_id) ?? '' : ''}</td>
                <td>{t(s.market === 'intl' ? 'market_intl' : 'market_ua')}</td>
                <td className="num">
                  {active.has(s.id)
                    ? <span className={`pill ${active.get(s.id)! <= 2 ? 'warn' : ''}`}>{t('lessonsLeft', { n: active.get(s.id)! })}</span>
                    : <span className="pill warn">{t('noPackage')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted">{t('nothingHere')}</p>}
      </div>

      {(
        <details className="card" style={{ marginTop: 16 }}>
          <summary>{t('kind_group')} / {t('kind_pair')} / {t('kind_club')}</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {(groups.data ?? []).map((g) => (
              <div key={g.id} className="spread">
                <span>{g.name}{g.level ? ` · ${g.level}` : ''} <span className="muted">· {t(`kind_${g.kind}` as never)}</span></span>
                <span className="muted">{g.teacher_id ? teacherName.get(g.teacher_id) : ''}</span>
              </div>
            ))}
            <form action={addGroup} className="form">
              <label>{t('name')}<input name="name" required /></label>
              <label>{t('level')}<input name="level" /></label>
              <label>{t('status')}
                <select name="kind" defaultValue="group">
                  <option value="group">{t('kind_group')}</option>
                  <option value="pair">{t('kind_pair')}</option>
                  <option value="club">{t('kind_club')}</option>
                </select>
              </label>
              <label>{t('teacher')}
                <select name="teacher_id" defaultValue="">
                  <option value="">…</option>
                  {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
              <button type="submit">{t('add')}</button>
            </form>
          </div>
        </details>
      )}
    </Shell>
  );
}
