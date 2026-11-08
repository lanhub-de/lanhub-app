import Link from 'next/link';
import type { Profile } from '@/lib/session';
import type { T } from '@/lib/i18n';
import { setLocale, signOut } from '@/app/actions';
import ChatBadge from '@/components/ChatBadge';
import StudentShell from '@/components/StudentShell';

type NavItem = { href: string; label: string };

function navFor(profile: Profile, t: T): NavItem[] {
  const teaching = [{ href: '/teacher', label: t('navToday') }];
  const library = [{ href: '/library', label: t('navLibrary') }];
  const chat = { href: '/chat', label: t('navChat') };
  switch (profile.role) {
    case 'owner':
      return [
        { href: '/school', label: t('navOverview') },
        ...teaching,
        chat,
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/groups', label: t('navGroups') },
        { href: '/school/lessons', label: t('navLessons') },
        { href: '/school/payouts', label: t('navPayouts') },
        { href: '/school/team', label: t('navTeam') },
        ...library,
      ];
    case 'head_teacher':
      return [
        { href: '/school', label: t('navOverview') },
        ...teaching,
        chat,
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/groups', label: t('navGroups') },
        { href: '/school/lessons', label: t('navLessons') },
        ...library,
      ];
    case 'manager':
      return [
        { href: '/school', label: t('navOverview') },
        chat,
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/groups', label: t('navGroups') },
        { href: '/school/lessons', label: t('navLessons') },
      ];
    case 'teacher':
      return [...teaching, chat, ...library];
    case 'student':
      return [{ href: '/me', label: t('navCourse') }, chat];
    default:
      return [];
  }
}

// School staff get a side menu (it becomes a scrolling row on a phone);
// teachers and students, with up to three sections, get them in the top bar.
export default function Shell({
  profile, t, active, children,
}: { profile: Profile; t: T; active: string; children: React.ReactNode }) {
  if (profile.role === 'student') {
    return <StudentShell t={t} locale={profile.locale} name={profile.full_name} active={active}>{children}</StudentShell>;
  }
  const items = navFor(profile, t);
  const side = items.length > 3;
  const initial = (profile.full_name.trim().charAt(0) || 'L').toUpperCase();
  const links = items.map((item) => (
    <Link key={item.href} href={item.href} className={active === item.href ? 'active' : ''}>
      {item.label}
      {item.href === '/chat' && <ChatBadge />}
    </Link>
  ));
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand-wrap">
          <span className="brand">LanHub</span>
          <span className="brand-sub">{profile.role === 'teacher' ? t('teacherCabinet') : t('platformSchool')}</span>
        </Link>
        {!side && <nav className="pills" aria-label="LanHub">{links}</nav>}
        <div className="who">
          <Link href="/settings" className="who-link">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span>{profile.full_name} · <span className="muted">{t(`role_${profile.role}`)}</span></span>
          </Link>
          <form action={setLocale} className="lang-switch">
            <input type="hidden" name="locale" value={profile.locale === 'en' ? 'uk' : 'en'} />
            <button type="submit" className="small" aria-label={profile.locale === 'en' ? 'Українська' : 'English'}>
              <span className={profile.locale === 'en' ? 'on' : ''}>EN</span>
              <span className={profile.locale === 'uk' ? 'on' : ''}>UA</span>
            </button>
          </form>
          <form action={signOut}><button className="small" type="submit">{t('signOut')}</button></form>
        </div>
      </header>
      {side ? (
        <div className="layout">
          <nav className="side" aria-label="LanHub">{links}</nav>
          <main className="content">{children}</main>
        </div>
      ) : (
        <main className="page">{children}</main>
      )}
    </>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="flash" role="alert">{error}</div>;
  if (ok) return <div className="flash ok" role="status">{ok}</div>;
  return null;
}
