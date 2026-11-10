// Removes homework files a year after the check (or hand-in, if never checked).
// Called once a day by pg_cron (private.run_homework_cleanup) with the secret
// from private.settings; the database checks the secret, this function only
// passes it on. Text, feedback and file names stay in the homework rows.
import { createClient } from 'npm:@supabase/supabase-js@2';

function serviceKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-cleanup-secret');
  if (req.method !== 'POST' || !secret) return new Response('Not allowed', { status: 403 });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey() as string, { auth: { persistSession: false } });

  let removed = 0;
  let files = 0;
  for (let round = 0; round < 20; round++) {
    const { data: due, error } = await sb.rpc('homework_files_due', { secret, p_limit: 200 });
    if (error) return new Response(error.message, { status: error.message.includes('Not allowed') ? 403 : 500 });
    if (!due?.length) break;
    const paths = due.flatMap((r: { file_path: string | null; feedback_file_path: string | null }) =>
      [r.file_path, r.feedback_file_path]).filter(Boolean) as string[];
    if (paths.length) {
      const { error: rmErr } = await sb.storage.from('homework').remove(paths);
      if (rmErr) return new Response(rmErr.message, { status: 500 });
      files += paths.length;
    }
    const { data: n, error: markErr } = await sb.rpc('homework_files_removed', { secret, ids: due.map((r: { id: string }) => r.id) });
    if (markErr) return new Response(markErr.message, { status: 500 });
    removed += n ?? 0;
    if (due.length < 200) break;
  }
  return Response.json({ removed, files });
});
