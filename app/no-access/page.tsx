import { translator } from '@/lib/i18n';
import { signOut } from '@/app/actions';

export default function NoAccess() {
  const uk = translator('uk');
  const en = translator('en');
  return (
    <div className="center">
      <div className="login card stack">
        <span className="brand">LanHub</span>
        <h1>{uk('noAccessTitle')}</h1>
        <p>{uk('noAccessText')}</p>
        <p className="muted">{en('noAccessText')}</p>
        <form action={signOut}><button type="submit">{uk('signOut')}</button></form>
      </div>
    </div>
  );
}
