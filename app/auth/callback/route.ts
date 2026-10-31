import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Sign-in by the link in the email (the code works too, see the login form).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const supabase = await supabaseServer();
  if (code) await supabase.auth.exchangeCodeForSession(code);
  else if (tokenHash) await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  return NextResponse.redirect(new URL('/', url.origin));
}
