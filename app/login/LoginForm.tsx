'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

type Labels = { email: string; send: string; sent: string; other: string };

// Sign-in with a one-time link sent to the email. No passwords.
// The link must be opened in the same browser: it finishes on /auth/callback.
// (Once the school's own mail sender is connected, the email can carry a code too.)
export default function LoginForm({ labels }: { labels: Labels }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (!sent) {
    return (
      <form className="stack" onSubmit={sendLink}>
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
    <div className="stack">
      <div className="flash ok" role="status">{labels.sent.replace('{email}', email)}</div>
      <button type="button" onClick={() => setSent(false)}>{labels.other}</button>
    </div>
  );
}
