import LoginForm from './LoginForm';
import { translator, type Locale } from '@/lib/i18n';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ lang?: string; e?: string }> }) {
  const { lang, e } = await searchParams;
  const locale: Locale = lang === 'en' ? 'en' : 'uk';
  const t = translator(locale);
  return (
    <div className="center">
      <div className="login card stack">
        <div className="spread">
          <span className="brand">LanHub</span>
          <a href={locale === 'uk' ? '/login?lang=en' : '/login'}>{locale === 'uk' ? 'English' : 'Українська'}</a>
        </div>
        <h1>{t('signIn')}</h1>
        {e === 'link' && <div className="flash" role="alert">{t('linkFailed')}</div>}
        <LoginForm labels={{ email: t('emailLabel'), send: t('sendCode'), sent: t('codeSent'), other: t('otherEmail') }} />
      </div>
    </div>
  );
}
