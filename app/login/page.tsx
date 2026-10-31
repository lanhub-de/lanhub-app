import LoginForm from './LoginForm';
import { translator, type Locale } from '@/lib/i18n';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
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
        <LoginForm
          labels={{
            email: t('emailLabel'), send: t('sendCode'), sent: t('codeSent'), code: t('codeLabel'),
            confirm: t('confirm'), other: t('otherEmail'),
          }}
        />
      </div>
    </div>
  );
}
