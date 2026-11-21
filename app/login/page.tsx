import LoginForm from './LoginForm';
import LocaleMark from '@/components/LocaleMark';
import Submit from '@/components/Submit';
import { signInWithPassword } from './actions';
import { translator, type Locale } from '@/lib/i18n';

// Two ways in: a code by email (first time, or no password), or a password set
// in Settings, so the team is not sent a code every time.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ lang?: string; e?: string; mode?: string }> }) {
  const { lang, e, mode } = await searchParams;
  const locale: Locale = lang === 'uk' ? 'uk' : 'en';
  const t = translator(locale);
  const withPassword = mode === 'password';
  const q = (m?: string) => {
    const p = new URLSearchParams();
    if (locale === 'uk') p.set('lang', 'uk');
    if (m) p.set('mode', m);
    const s = p.toString();
    return s ? `/login?${s}` : '/login';
  };
  return (
    <div className="center">
      <LocaleMark locale={locale} />
      <div className="login card stack">
        <div className="spread">
          <span className="brand">LanHub</span>
          <a href={locale === 'en' ? `/login?lang=uk${withPassword ? '&mode=password' : ''}` : `/login${withPassword ? '?mode=password' : ''}`}>
            {locale === 'en' ? 'Українська' : 'English'}
          </a>
        </div>
        <h1>{t('signIn')}</h1>
        {e === 'link' && <div className="flash" role="alert">{t('linkFailed')}</div>}
        {withPassword ? (
          <form action={signInWithPassword} className="stack">
            <input type="hidden" name="lang" value={locale} />
            <label>
              {t('emailLabel')}
              <input type="email" name="email" required autoComplete="username" />
            </label>
            <label>
              {t('passwordLabel')}
              <input type="password" name="password" required autoComplete="current-password" />
            </label>
            {e === 'pw' && <div className="flash" role="alert">{t('pwFailed')}</div>}
            <Submit className="primary">{t('pwSignIn')}</Submit>
          </form>
        ) : (
          <LoginForm labels={{ email: t('emailLabel'), send: t('sendCode'), sent: t('codeSent'), code: t('codeLabel'), confirm: t('confirm'), other: t('otherEmail') }} />
        )}
        <a href={q(withPassword ? undefined : 'password')} style={{ fontSize: 14 }}>
          {withPassword ? t('codeTab') : t('pwTab')}
        </a>
      </div>
    </div>
  );
}
