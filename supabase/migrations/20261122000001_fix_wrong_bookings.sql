-- Fixing wrong bookings.
--  * Nobody (the head teacher and the owner included) can mark a lesson held
--    or missed before it starts: it would count in the package and the pay.
--  * The head teacher deletes lessons like a manager, to clean up mistakes
--    (teachers still delete only their own booking within a day).

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

drop policy lessons_delete on public.lessons;
create policy lessons_delete on public.lessons for delete using (
  public.has_role('owner', 'manager', 'head_teacher')
  or (teacher_id = auth.uid() and created_by = auth.uid() and status = 'scheduled'
      and starts_at > now() and created_at > now() - interval '24 hours')
);
