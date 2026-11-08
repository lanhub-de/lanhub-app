import Link from 'next/link';
import type { Locale, T } from '@/lib/i18n';
import { setLocale } from '@/app/actions';
import ChatBadge from '@/components/ChatBadge';
import { IconBook, IconCalendar, IconChat, IconHome } from '@/components/Icons';

type Item = { href: string; label: string; icon: React.ReactNode; chat?: boolean };

// The student's frame, as in the mockup: LanHub, the menu as pills and her
// name on a computer; on a phone the menu moves to a tab bar at the bottom.
// The school and teachers see the same frame in "view as student" (preview),
// with the menu shown but not clickable and a bar to go back.
export default function StudentShell({
  t, locale, name, active, children, preview,
}: {
  t: T; locale: Locale; name: string; active: string; children: React.ReactNode;
  preview?: { back: string; label: string; text?: string; base?: string };
}) {
  const items: Item[] = [
    { href: '/me', label: t('navHome'), icon: <IconHome /> },
    { href: '/me/schedule', label: t('navSchedule'), icon: <IconCalendar /> },
    { href: '/me/materials', label: t('navMaterials'), icon: <IconBook /> },
    { href: '/chat', label: t('navChatOne'), icon: <IconChat />, chat: true },
  ];
  const first = name.trim().split(/\s+/)[0] || name;
  const initial = (first.charAt(0) || 'L').toUpperCase();
  const link = (i: Item, tab: boolean) => {
    const cls = active === i.href ? 'active' : '';
    const inner = (
      <>
        {tab && i.icon}
        <span>{i.label}</span>
        {i.chat && !preview && <ChatBadge />}
      </>
    );
    if (preview && !preview.base) return <span key={i.href} className={cls} aria-disabled="true">{inner}</span>;
    // in "view as student" the tabs lead to the same pages under the preview address
    const href = preview?.base ? `${preview.base}${i.href === '/me' ? '' : i.href.replace(/^\/me/, '')}` : i.href;
    return <Link key={i.href} href={href} className={cls} aria-current={cls ? 'page' : undefined}>{inner}</Link>;
  };
  return (
    <div className="s-frame">
      {preview && (
        <div className="s-preview-bar">
          <span>👁 {preview.text ?? t('studentPreviewBar', { name })}</span>
          <Link href={preview.back}>← {preview.label}</Link>
        </div>
      )}
      <header className="topbar s-top">
        <Link href={preview ? preview.back : '/me'} className="brand-wrap">
          <span className="brand">LanHub</span>
          <span className="brand-sub">{t('studentCabinet')}</span>
        </Link>
        <nav className="pills s-pills" aria-label={t('studentMenu')}>{items.map((i) => link(i, false))}</nav>
        <div className="who">
          {!preview && (
            <form action={setLocale} className="lang-switch">
              <input type="hidden" name="locale" value={locale === 'en' ? 'uk' : 'en'} />
              <button type="submit" className="small" aria-label={locale === 'en' ? 'Українська' : 'English'}>
                <span className={locale === 'uk' ? 'on' : ''}>UA</span>
                <span className={locale === 'en' ? 'on' : ''}>EN</span>
              </button>
            </form>
          )}
          {preview ? (
            <span className="who-link"><span className="avatar soft" aria-hidden="true">{initial}</span><span className="s-name">{first}</span></span>
          ) : (
            <Link href="/settings" className="who-link" aria-label={t('settings')}>
              <span className="avatar soft" aria-hidden="true">{initial}</span><span className="s-name">{first}</span>
            </Link>
          )}
        </div>
      </header>
      <main className="s-page">{children}</main>
      <nav className="tabbar" aria-label={t('studentMenu')}>{items.map((i) => link(i, true))}</nav>
    </div>
  );
}
