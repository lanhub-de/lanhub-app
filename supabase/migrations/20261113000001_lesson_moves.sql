-- Fixing and moving booked lessons.
--  * Every change of a lesson's time is kept: from, to, who, when. A move to
--    another day is shown to the school, and so is one made inside the
--    teacher's cancellation window (late). Fixing the time on the same day is
--    free and only kept in the history.
--  * A teacher moves only a lesson that is not marked yet.
--  * A teacher may delete a lesson she booked herself by mistake: before it
--    starts and within 24 hours of booking it. Otherwise the school does it.

create table public.lesson_moves (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  from_at timestamptz not null,
  to_at timestamptz not null,
  day_changed boolean not null,
  late boolean not null,
  moved_by uuid references public.profiles (id) on delete set null,
  moved_at timestamptz not null default now()
);
create index lesson_moves_lesson on public.lesson_moves (lesson_id, moved_at);

alter table public.lesson_moves enable row level security;
create policy lesson_moves_select on public.lesson_moves for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid())
);
revoke all on public.lesson_moves from anon;
grant select on public.lesson_moves to authenticated;

create function public.guard_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at
     and not public.has_role('owner', 'head_teacher', 'manager')
     and (old.status <> 'scheduled' or new.status <> 'scheduled') then
    raise exception 'Only a lesson that is not marked yet can be moved' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger lessons_guard_move before update of starts_at on public.lessons
  for each row execute function public.guard_lesson_move();

create function public.log_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hours int;
begin
  if new.starts_at is not distinct from old.starts_at then return new; end if;
  hours := coalesce((select ts.cancel_hours from public.teacher_settings ts where ts.teacher_id = old.teacher_id), 24);
  insert into public.lesson_moves (lesson_id, from_at, to_at, day_changed, late, moved_by)
  values (new.id, old.starts_at, new.starts_at,
          (old.starts_at at time zone 'Europe/Kyiv')::date <> (new.starts_at at time zone 'Europe/Kyiv')::date,
          now() > old.starts_at - make_interval(hours => hours),
          (select p.id from public.profiles p where p.id = auth.uid()));
  return new;
end $$;

create trigger lessons_log_move after update of starts_at on public.lessons
  for each row execute function public.log_lesson_move();

revoke execute on function public.guard_lesson_move() from public, anon, authenticated;
revoke execute on function public.log_lesson_move() from public, anon, authenticated;

drop policy lessons_delete on public.lessons;
create policy lessons_delete on public.lessons for delete using (
  public.has_role('owner', 'manager')
  or (teacher_id = auth.uid() and created_by = auth.uid() and status = 'scheduled'
      and starts_at > now() and created_at > now() - interval '24 hours')
);
