-- Lesson length per lesson, packages for the head teacher, a warm site.
--
--  * A booked lesson's length can be changed (60 → 90 min) like its time:
--    while it is not marked yet, and the change is kept in the lesson's
--    history next to the moves, so the school sees it (length changes pay).
--  * The head teacher adds and edits packages (lessons, validity, status);
--    payments stay with the owner and managers.
--  * The free server falls asleep after 15 quiet minutes and then takes up to
--    a minute to wake; a ping every 10 minutes in the daytime keeps it awake.

alter table public.lesson_moves add column if not exists from_min int, add column if not exists to_min int;

create or replace function public.guard_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min)
     and not public.has_role('owner', 'head_teacher', 'manager')
     and (old.status <> 'scheduled' or new.status <> 'scheduled') then
    raise exception 'Only a lesson that is not marked yet can be moved or changed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.log_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hours int;
  moved boolean := new.starts_at is distinct from old.starts_at;
begin
  if not moved and new.duration_min is not distinct from old.duration_min then return new; end if;
  hours := coalesce((select ts.cancel_hours from public.teacher_settings ts where ts.teacher_id = old.teacher_id), 24);
  insert into public.lesson_moves (lesson_id, from_at, to_at, day_changed, late, moved_by, from_min, to_min)
  values (new.id, old.starts_at, new.starts_at,
          moved and (old.starts_at at time zone 'Europe/Kyiv')::date <> (new.starts_at at time zone 'Europe/Kyiv')::date,
          moved and now() > old.starts_at - make_interval(hours => hours),
          (select p.id from public.profiles p where p.id = auth.uid()),
          old.duration_min, new.duration_min);
  return new;
end $$;

drop trigger if exists lessons_guard_move on public.lessons;
create trigger lessons_guard_move before update of starts_at, duration_min on public.lessons
  for each row execute function public.guard_lesson_move();
drop trigger if exists lessons_log_move on public.lessons;
create trigger lessons_log_move after update of starts_at, duration_min on public.lessons
  for each row execute function public.log_lesson_move();

drop policy packages_write on public.packages;
create policy packages_write on public.packages for all
  using (public.has_role('owner', 'manager', 'head_teacher'))
  with check (public.has_role('owner', 'manager', 'head_teacher'));

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'keep-site-warm';
    -- 07:00–23:59 Kyiv (UTC+2 in winter)
    perform cron.schedule('keep-site-warm', '*/10 5-21 * * *',
      $c$select net.http_get('https://lanhub-app.onrender.com/api/version')$c$);
  end if;
end $$;
