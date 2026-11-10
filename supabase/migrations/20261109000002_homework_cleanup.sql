-- Homework files (photos, voice, documents, the teacher's check file) are
-- removed a year after the check, or a year after hand-in if never checked.
-- The text, the feedback and the file's name stay, so the history reads on.
--
-- Storage objects can only be removed through the Storage API, so a small
-- edge function (supabase/functions/homework-cleanup) asks for the due files,
-- removes them and marks the rows. A daily pg_cron job calls it with a secret
-- that lives in private.settings and never leaves the database.

alter table public.homework add column if not exists files_removed_at timestamptz;

alter table public.homework drop constraint if exists homework_check;
alter table public.homework add constraint homework_check
  check (nullif(trim(coalesce(body, '')), '') is not null or file_path is not null or files_removed_at is not null);

insert into private.settings (key, value)
values ('cleanup_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.homework_files_due(secret text, p_limit int default 200)
returns table (id uuid, file_path text, feedback_file_path text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if secret is null or secret is distinct from (select value from private.settings where key = 'cleanup_secret') then
    raise exception 'Not allowed';
  end if;
  return query
  select h.id, h.file_path, h.feedback_file_path
    from public.homework h
   where (h.file_path is not null or h.feedback_file_path is not null)
     and coalesce(h.checked_at, h.submitted_at) < now() - interval '1 year'
   order by coalesce(h.checked_at, h.submitted_at)
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

-- Called once the files are gone from storage.
create or replace function public.homework_files_removed(secret text, ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if secret is null or secret is distinct from (select value from private.settings where key = 'cleanup_secret') then
    raise exception 'Not allowed';
  end if;
  update public.homework h
     set file_path = null, feedback_file_path = null, files_removed_at = now()
   where h.id = any(ids)
     and coalesce(h.checked_at, h.submitted_at) < now() - interval '1 year';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.homework_files_due(text, int) from public, anon, authenticated;
revoke execute on function public.homework_files_removed(text, uuid[]) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.homework_files_due(text, int) to service_role;
    grant execute on function public.homework_files_removed(text, uuid[]) to service_role;
  end if;
end $$;

-- The daily call. pg_net sends it without waiting; the edge function does the work.
create or replace function private.run_homework_cleanup()
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce((select value from private.settings where key = 'functions_url'),
                        'https://euxlnwpaeydhkpoggcnn.supabase.co/functions/v1');
begin
  return net.http_post(
    url := base || '/homework-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cleanup-secret', (select value from private.settings where key = 'cleanup_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;

revoke execute on function private.run_homework_cleanup() from public;

-- Scheduling only where pg_cron exists (the hosted database, not the tests).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'homework-cleanup';
    perform cron.schedule('homework-cleanup', '23 2 * * *', 'select private.run_homework_cleanup()');
  end if;
end $$;
