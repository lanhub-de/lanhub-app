import Shell, { Flash } from '@/components/Shell';
import { requireProfile, TEACHING } from '@/lib/session';
import { saveSettings, signOut } from '@/app/actions';

export default async function Settings({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { supabase, profile, t } = await requireProfile();
  const sp = await searchParams;
  const teaches = TEACHING.includes(profile.role);
  const { data: ts } = teaches
    ? await supabase.from('teacher_settings').select('zoom_url').eq('teacher_id', profile.id).maybeSingle()
    : { data: null };
  return (
    <Shell profile={profile} t={t} active="/settings">
      <h1>{t('settings')}</h1>
      <Flash ok={sp.ok ? t('saved') : undefined} error={sp.e} />
      <form action={saveSettings} className="card stack" style={{ maxWidth: 480 }}>
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
        {teaches && (
          <label>
            {t('myZoomRoom')}
            <input type="url" name="zoom_url" defaultValue={(ts as { zoom_url: string | null } | null)?.zoom_url ?? ''} placeholder="https://us06web.zoom.us/j/…" />
            <small className="muted">{t('myZoomRoomHint')}</small>
          </label>
        )}
        <button className="primary" type="submit">{t('save')}</button>
      </form>
      <form action={signOut} style={{ marginTop: 16 }}>
        <button type="submit">{t('signOut')}</button>
      </form>
    </Shell>
  );
}
