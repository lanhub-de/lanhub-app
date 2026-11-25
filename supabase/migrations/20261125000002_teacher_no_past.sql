-- A lesson is planned first and held afterwards.
--  * From the school's set day (1 December 2026) a teacher books lessons for
--    today and ahead only. A lesson on a day already past is entered by the
--    school (owner, head teacher, managers), who can still fix the journal.
--  * For the same reason a teacher cannot move a lesson to another day that
--    is already past; fixing the time within the lesson's own day stays free.

insert into private.settings (key, value) values ('teacher_no_past_from', '2026-12-01')
on conflict (key) do nothing;

create function public.teacher_no_past() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(now() >= (select (value::date)::timestamp at time zone 'Europe/Kyiv'
                              from private.settings where key = 'teacher_no_past_from'), false)
$$;
revoke execute on function public.teacher_no_past() from public, anon, authenticated;

-- midnight today in Kyiv
create function public.kyiv_day_start() returns timestamptz
language sql stable set search_path = public as $$
  select date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv'
$$;

create or replace function public.lessons_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.app_role := public.current_app_role();
  paid boolean;
begin
  if new.student_id is not null then
    new.band := public.level_to_band((select level from public.students where id = new.student_id));
  else
    select public.level_to_band(g.level), g.kind
      into new.band, new.kind
      from public.groups g where g.id = new.group_id;
  end if;

  if r = 'teacher' then
    -- trials and diagnostics are booked by the school
    if new.student_id is not null then
      new.kind := case when tg_op = 'UPDATE' and old.kind in ('trial', 'diagnostic')
                       then old.kind else 'individual' end;
    end if;
    -- packages are attached by the system, not by the teacher
    if tg_op = 'UPDATE' then
      new.package_id := old.package_id;
    else
      new.package_id := null;
    end if;
    -- a lesson is planned first and held afterwards: from the school's set
    -- day a teacher books for today and ahead, and a day already past is
    -- entered by the school
    if tg_op = 'INSERT' and public.teacher_no_past() and new.starts_at < public.kyiv_day_start() then
      raise exception 'Минулі дати вносить школа / Lessons in the past are added by the school' using errcode = 'P0001';
    end if;
    -- a late cancellation only exists inside the teacher's cancellation window
    if new.status = 'late_cancel' and new.starts_at > now() + make_interval(hours =>
         coalesce((select ts.cancel_hours from public.teacher_settings ts
                    where ts.teacher_id = new.teacher_id), 24)) then
      raise exception 'Cancelled in time: this lesson does not count' using errcode = 'P0001';
    end if;
  end if;

  -- nobody marks a lesson held (or missed) before it starts: it would count
  -- in the package and the pay
  if new.status in ('done', 'no_show') and new.starts_at > now() + interval '15 minutes'
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.starts_at is distinct from old.starts_at) then
    raise exception 'A lesson cannot be marked done before it starts' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and r is distinct from 'owner' then
    select exists (
      select 1 from public.payout_reviews pr
      where pr.teacher_id = old.teacher_id
        and pr.month = date_trunc('month', old.starts_at)::date
        and pr.status = 'paid'
    ) into paid;
    if paid then
      raise exception 'This month is already paid out and locked' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.marked_at := now();
  end if;

  -- Undoing a counted status releases the package seat.
  if tg_op = 'UPDATE' and public.is_counted(old.status) and not public.is_counted(new.status) then
    new.package_id := null;
  end if;

  -- A counted individual lesson takes its hours from the student's oldest
  -- active package that still has hours left and has not expired.
  if public.is_counted(new.status) and new.student_id is not null and new.package_id is null
     and new.kind in ('individual') then
    select p.id into new.package_id
      from public.packages p
     where p.student_id = new.student_id
       and p.status = 'active'
       and (p.first_lesson_at is null or public.package_valid_until(p) >= new.starts_at)
       and public.package_units_used(p.id, new.id) < p.lessons_total
     order by p.created_at
     limit 1;
  end if;

  return new;
end
$$;

revoke execute on function public.lessons_before_write() from public, anon, authenticated;

create or replace function public.guard_lesson_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- these limits are for teachers; the school (and the system itself) fixes the journal freely
  if public.has_role('owner', 'head_teacher', 'manager') or auth.uid() is null then return new; end if;
  if (new.starts_at is distinct from old.starts_at or new.duration_min is distinct from old.duration_min)
     and (old.status not in ('scheduled', 'rescheduled') or new.status <> 'scheduled') then
    raise exception 'Only a lesson that is not marked yet can be moved or changed' using errcode = 'P0001';
  end if;
  if new.starts_at is distinct from old.starts_at and public.teacher_no_past()
     and new.starts_at < public.kyiv_day_start()
     and (new.starts_at at time zone 'Europe/Kyiv')::date <> (old.starts_at at time zone 'Europe/Kyiv')::date then
    raise exception 'Минулі дати вносить школа / Lessons in the past are added by the school' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.guard_lesson_move() from public, anon, authenticated;
