// The version this server is running; open pages compare it with their own.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ v: process.env.NEXT_PUBLIC_BUILD_ID ?? '' }, { headers: { 'cache-control': 'no-store' } });
}
