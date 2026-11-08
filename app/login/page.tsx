import LoginForm from './LoginForm';
import { translator, type Locale } from '@/lib/i18n';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ lang?: string; e?: string }> }) {
  const { lang, e } = await searchParams;
  const locale: Locale = lang === 'uk' ? 'uk' : 'en';
  const t = translator(locale);
  return (
    <div className="center">
      <div className="login card stack">
        <div className="spread">
          <span className="brand">LanHub</span>
          <a href={locale === 'en' ? '/login?lang=uk' : '/login'}>{locale === 'en' ? 'Українська' : 'English'}</a>
        </div>
        <h1>{t('signIn')}</h1>
        {e === 'link' && <div className="flash" role="alert">{t('linkFailed')}</div>}
        <LoginForm labels={{ email: t('emailLabel'), send: t('sendCode'), sent: t('codeSent'), code: t('codeLabel'), confirm: t('confirm'), other: t('otherEmail') }} />
      </div>
    </div>
  );
}
