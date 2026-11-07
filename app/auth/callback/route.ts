import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Finishes sign-in from the link in the email.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const supabase = await supabaseServer();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash) {
    const otpType = type === 'signup' || type === 'magiclink' || type === 'invite' ? type : 'email';
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })).error;
  }
  // Behind Render's proxy the request URL says localhost, so take the public
  // address from the forwarded headers.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return NextResponse.redirect(new URL(ok ? '/' : '/login?e=link', `${proto}://${host}`));
}
