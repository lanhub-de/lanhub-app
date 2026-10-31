import Shell, { Flash } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import { saveSettings } from '@/app/actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { profile, t } = await requireProfile();
  const sp = await searchParams;
  return (
    <Shell profile={profile} t={t} active="/settings">
      <h1>{t('settings')}</h1>
      <Flash ok={sp.ok ? t('saved') : undefined} error={sp.e} />
      <form action={saveSettings} className="card stack" style={{ maxWidth: 420 }}>
        <label>
          {t('name')}
          <input name="full_name" defaultValue={profile.full_name} />
        </label>
        <label>
          {t('language')}
          <select name="locale" defaultValue={profile.locale}>
            <option value="uk">Українська</option>
            <option value="en">English</option>
          </select>
        </label>
        <button className="primary" type="submit">{t('save')}</button>
      </form>
    </Shell>
  );
}
