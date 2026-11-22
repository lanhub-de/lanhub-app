-- A package counts hours, not lesson slots: a 60-minute lesson uses 1, a
-- 90-minute one 1.5, a 45-minute one 0.75. "Lessons left" can therefore be
-- 2.5. Teacher pay already goes by the hour (90 min = 1.5 x the rate).

create or replace function public.lesson_units(minutes int) returns numeric
language sql immutable set search_path = public as $$
  select round(coalesce(nullif(minutes, 0), 60)::numeric / 60, 2)
$$;

create or replace function public.package_units_used(pid uuid, except_lesson uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.lesson_units(l.duration_min)), 0)
    from public.lessons l
   where l.package_id = pid and public.is_counted(l.status)
     and (except_lesson is null or l.id <> except_lesson)
$$;
revoke execute on function public.package_units_used(uuid, uuid) from public, anon, authenticated;

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
    -- a lesson cannot be marked before it starts
    if new.status in ('done', 'no_show')
       and new.starts_at > now() + interval '15 minutes' then
      raise exception 'A lesson cannot be marked done before it starts' using errcode = 'P0001';
    end if;
    -- a late cancellation only exists inside the teacher's cancellation window
    if new.status = 'late_cancel' and new.starts_at > now() + make_interval(hours =>
         coalesce((select ts.cancel_hours from public.teacher_settings ts
                    where ts.teacher_id = new.teacher_id), 24)) then
      raise exception 'Cancelled in time: this lesson does not count' using errcode = 'P0001';
    end if;
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

create or replace function public.lessons_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_lesson_pay(new.id);

  if new.status = 'force_majeure' and new.student_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'force_majeure') then
    update public.packages p
       set extra_days = p.extra_days + public.force_majeure_extension_days()
     where p.id = (select p2.id from public.packages p2
                    where p2.student_id = new.student_id and p2.status = 'active'
                    order by p2.created_at limit 1);
  end if;

  if new.package_id is not null or (tg_op = 'UPDATE' and old.package_id is not null) then
    update public.packages p
       set first_lesson_at = (select min(l.starts_at) from public.lessons l
                               where l.package_id = p.id and public.is_counted(l.status)),
           status = case when public.package_units_used(p.id) >= p.lessons_total then 'finished' else 'active' end
     where p.id in (new.package_id, case when tg_op = 'UPDATE' then old.package_id end)
       and p.status <> 'cancelled';
  end if;

  return null;
end
$$;

revoke execute on function public.lessons_before_write() from public, anon, authenticated;
revoke execute on function public.lessons_after_write() from public, anon, authenticated;

drop view public.students_not_renewed;
drop view public.package_usage;

create view public.package_usage with (security_invoker = true) as
with used as (
  select p.*, (select coalesce(sum(public.lesson_units(l.duration_min)), 0) from public.lessons l
                where l.package_id = p.id and public.is_counted(l.status)) as lessons_used
    from public.packages p
)
select u.id as package_id, u.student_id, u.lessons_total, trim_scale(u.lessons_used) as lessons_used,
       trim_scale(u.lessons_total - u.lessons_used) as lessons_left,
       u.first_lesson_at,
       u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) as valid_until,
       case
         when u.status = 'active'
          and u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) < now()
           then 'expired'
         else u.status
       end as status
  from used u;

create view public.students_not_renewed with (security_invoker = true) as
select s.id as student_id, s.full_name, s.level, s.teacher_id,
       max(pu.valid_until) as last_valid_until
  from public.students s
  join public.package_usage pu on pu.student_id = s.id
 where s.status = 'active'
 group by s.id
having bool_and(pu.status <> 'active');

revoke all on public.package_usage, public.students_not_renewed from anon;
grant select on public.package_usage, public.students_not_renewed to authenticated;

-- packages already used up by hours are finished
update public.packages p set status = 'finished'
 where p.status = 'active' and public.package_units_used(p.id) >= p.lessons_total;
