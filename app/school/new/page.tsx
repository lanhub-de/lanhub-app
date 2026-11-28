import Shell, { Flash } from '@/components/Shell';
import { requireProfile, STAFF } from '@/lib/session';
import { INVITE, pendingTeachers } from '@/lib/invites';
import { addStudentFull } from '../actions';
import PackageFields from '@/components/PackageFields';
import Submit from '@/components/Submit';

// A new student in one go: her card, her teacher, and the package she bought.
export default async function NewStudentPage({ searchParams }: { searchParams: Promise<{ teacher?: string; e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(STAFF);
  const sp = await searchParams;
  const canSell = profile.role === 'owner' || profile.role === 'manager';
  const [teachers, invited] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher', 'owner']).eq('active', true).order('full_name'),
    pendingTeachers(supabase),
  ]);

  return (
    <Shell profile={profile} t={t} active="/school/students">
      <h1 style={{ marginBottom: 4 }}>{t('newStudentTitle')}</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>{t('newStudentLead')}</p>
      <Flash error={sp.e} />
      <form action={addStudentFull} className="new-student">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>1. {t('newStudentCard')}</h2>
          <label>{t('name')}<input name="full_name" required maxLength={120} placeholder={t('realNameHint')} /></label>
          {canSell && <label>Instagram<input name="instagram" maxLength={100} placeholder="@nick" /></label>}
          <label>{t('contact')}<input name="contact" maxLength={200} placeholder="Telegram, +380…" /></label>
          <div className="two">
            <label>{t('level')}<input name="level" maxLength={20} placeholder="A2, B1…" /></label>
            <label>{t('market')}
              <select name="market" defaultValue="ua">
                <option value="ua">{t('market_ua')}</option>
                <option value="intl">{t('market_intl')}</option>
              </select>
            </label>
          </div>
          <label>{t('teacher')}
            <select name="teacher_id" defaultValue={sp.teacher ?? ''} required>
              <option value="" disabled>…</option>
              {(teachers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              {invited.map((i) => <option key={i.email} value={`${INVITE}${i.email}`}>{i.full_name} · {t('pending')}</option>)}
            </select>
          </label>
          <label>{t('scheduleNote')}<input name="schedule_note" maxLength={200} placeholder={t('scheduleNoteHint')} /></label>
          <label>{t('emailLabel')}<input type="email" name="email" placeholder={t('optional')} /></label>
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>2. {t('pkgAndPay')}</h2>
          <PackageFields t={t} canSell={canSell} optionalPackage />
          <Submit className="primary">{t('newStudentSave')}</Submit>
        </section>
      </form>
    </Shell>
  );
}
