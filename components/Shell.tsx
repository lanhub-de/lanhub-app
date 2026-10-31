import Link from 'next/link';
import type { Profile } from '@/lib/session';
import type { T } from '@/lib/i18n';
import { signOut } from '@/app/actions';

type NavItem = { href: string; label: string };

function navFor(profile: Profile, t: T): NavItem[] {
  const teaching = [{ href: '/teacher', label: t('navToday') }];
  const library = [{ href: '/library', label: t('navLibrary') }];
  switch (profile.role) {
    case 'owner':
      return [
        { href: '/school', label: t('navOverview') },
        ...teaching,
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/lessons', label: t('navLessons') },
        { href: '/school/payouts', label: t('navPayouts') },
        { href: '/school/team', label: t('navTeam') },
        ...library,
      ];
    case 'head_teacher':
      return [
        { href: '/school', label: t('navOverview') },
        ...teaching,
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/lessons', label: t('navLessons') },
        ...library,
      ];
    case 'manager':
      return [
        { href: '/school', label: t('navOverview') },
        { href: '/school/students', label: t('navStudents') },
        { href: '/school/lessons', label: t('navLessons') },
      ];
    case 'teacher':
      return [...teaching, ...library];
    default:
      return [];
  }
}

export default function Shell({
  profile, t, active, children,
}: { profile: Profile; t: T; active: string; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">LanHub</Link>
        <nav className="nav" aria-label="LanHub">
          {navFor(profile, t).map((item) => (
            <Link key={item.href} href={item.href} className={active === item.href ? 'active' : ''}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <Link href="/settings">{profile.full_name}</Link>
          <span className="muted">{t(`role_${profile.role}`)}</span>
          <form action={signOut}><button className="small" type="submit">{t('signOut')}</button></form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="flash" role="alert">{error}</div>;
  if (ok) return <div className="flash ok" role="status">{ok}</div>;
  return null;
}
