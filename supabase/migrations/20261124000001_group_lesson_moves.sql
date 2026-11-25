-- Group lessons move like individual ones.
--  * A lesson marked "rescheduled" (postponed, new date not known yet) gets its
--    new time later: the teacher moves it and it is a booked lesson again.
--    Any other marked lesson still stays put for a teacher; the school fixes those.

create or replace function public.guard_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min)
     and not public.has_role('owner', 'head_teacher', 'manager')
     and (old.status not in ('scheduled', 'rescheduled') or new.status <> 'scheduled') then
    raise exception 'Only a lesson that is not marked yet can be moved or changed' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.guard_lesson_move() from public, anon, authenticated;
