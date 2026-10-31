'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Labels = { email: string; send: string; sent: string; code: string; confirm: string; other: string };

// Sign-in with a one-time code sent to the email. No passwords.
export default function LoginForm({ labels }: { labels: Labels }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(error.message);
    else window.location.href = '/';
  }

  if (step === 'email') {
    return (
      <form className="stack" onSubmit={sendCode}>
        <label>
          {labels.email}
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <div className="flash" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{labels.send}</button>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={verify}>
      <p className="muted">{labels.sent.replace('{email}', email)}</p>
      <label>
        {labels.code}
        <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {error && <div className="flash" role="alert">{error}</div>}
      <button className="primary" type="submit" disabled={busy}>{labels.confirm}</button>
      <button type="button" onClick={() => { setStep('email'); setCode(''); }}>{labels.other}</button>
    </form>
  );
}
