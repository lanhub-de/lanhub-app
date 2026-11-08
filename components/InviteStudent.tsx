import type { Locale, T } from '@/lib/i18n';
import { fmtDate } from '@/lib/i18n';
import { inviteStudent } from '@/app/teacher/actions';
import Submit from '@/components/Submit';

export type InviteInfo = {
  id: string; full_name: string; email: string | null; locale: string | null;
  invited_at: string | null; profile_id: string | null; market?: string | null;
};

// "Invite to LanHub" on a student's card: her email (she signs in with it),
// the language of the letter, and where things stand.
export default function InviteStudent({ t, locale, returnTo, s }: { t: T; locale: Locale; returnTo: string; s: InviteInfo }) {
  if (s.profile_id) {
    return (
      <div className="card invite-card">
        <h2 className="s-h">{t('inviteTitle')}</h2>
        <span className="pill ok" style={{ alignSelf: 'flex-start' }}>✓ {t('inviteJoined')}</span>
        {s.email && <small className="muted">{s.email}</small>}
      </div>
    );
  }
  return (
    <form action={inviteStudent} className="card invite-card">
      <h2 className="s-h">{t('inviteTitle')}</h2>
      {s.invited_at
        ? <span className="pill warn" style={{ alignSelf: 'flex-start' }}>{t('inviteSentOn', { date: fmtDate(s.invited_at, locale) })}</span>
        : <small className="muted">{t('inviteStudentHint')}</small>}
      <input type="hidden" name="student_id" value={s.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label>{t('emailLabel')}<input type="email" name="email" required defaultValue={s.email ?? ''} placeholder="name@gmail.com" /></label>
      <label>
        {t('inviteLang')}
        <select name="locale" defaultValue={s.locale === 'en' || s.market === 'intl' ? 'en' : 'uk'}>
          <option value="uk">Українська</option>
          <option value="en">English</option>
        </select>
      </label>
      <Submit className="primary small">{s.invited_at ? t('inviteAgain') : t('inviteSend')}</Submit>
    </form>
  );
}
