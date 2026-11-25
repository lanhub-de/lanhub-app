-- Diagnostics (and trial lessons) are booked by the school for a teacher and
-- paid the same flat amount to every teacher once held: 400 UAH, kept as a
-- school setting. A teacher's own rate for the kind, if she has one, wins.
-- Like any lesson, only one actually held is paid.

insert into private.settings (key, value) values ('diagnostic_pay', '400')
on conflict (key) do nothing;

create function public.diagnostic_pay() returns numeric
language sql stable security definer set search_path = public, private as $$
  select coalesce((select value::numeric from private.settings where key = 'diagnostic_pay'), 400)
$$;
revoke execute on function public.diagnostic_pay() from public, anon, authenticated;

-- the amount, for the owner's Team page
create function public.diagnostic_pay_shown() returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.has_role('owner') then public.diagnostic_pay() end
$$;
revoke execute on function public.diagnostic_pay_shown() from public, anon;
grant execute on function public.diagnostic_pay_shown() to authenticated;

create or replace function public.write_lesson_pay(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.lessons;
  rid uuid;
  rate numeric;
  step numeric;
  rate_currency text;
  stu_market text;
  pkg_size int;
  present int;
begin
  select * into l from public.lessons where id = lid;
  if l.id is null then return; end if;

  -- only a lesson actually held is paid; lessons before the platform took
  -- over pay (paid outside it) get no pay either
  if not public.is_paid(l.status) or l.pending_teacher is not null or l.starts_at < public.pay_start() then
    delete from public.lesson_pay where lesson_id = l.id;
    return;
  end if;

  select market into stu_market from public.students where id = l.student_id;
  select lessons_total into pkg_size from public.packages where id = l.package_id;
  present := public.lesson_present(l.id);
  -- a group lesson everyone was marked absent from was not held
  -- (a group with no members listed yet is paid as before)
  if l.group_id is not null and coalesce(present, 1) < 1
     and exists (select 1 from public.group_members m where m.group_id = l.group_id) then
    delete from public.lesson_pay where lesson_id = l.id;
    return;
  end if;

  select tr.id, tr.amount, tr.currency into rid, rate, rate_currency
    from public.teacher_rates tr
   where tr.teacher_id = l.teacher_id
     and tr.kind = l.kind
     and tr.valid_from <= l.starts_at::date
     and (tr.band is null or tr.band = l.band)
     and (tr.market is null or tr.market = stu_market)
     and (tr.package_lessons is null or tr.package_lessons = pkg_size)
     and (tr.student_id is null or tr.student_id = l.student_id)
     and (tr.group_id is null or tr.group_id = l.group_id)
   order by (tr.student_id is not null or tr.group_id is not null) desc,
            (tr.market is not null) desc,
            (tr.package_lessons is not null) desc,
            (tr.band is not null) desc,
            tr.valid_from desc
   limit 1;

  -- a diagnostic or a trial lesson is paid the school's flat amount, the same
  -- for every teacher, unless she has a rate of her own for it
  if rid is null and l.kind in ('trial', 'diagnostic') then
    rate := public.diagnostic_pay();
    rate_currency := 'UAH';
  end if;

  if rid is not null and present is not null then
    select s.amount into step from public.rate_steps s
     where s.rate_id = rid and s.min_present <= present
     order by s.min_present desc limit 1;
    rate := coalesce(step, rate);
  end if;

  -- individual lessons are paid by the hour: 90 minutes = 1.5 x the rate
  if l.kind = 'individual' and rate is not null and coalesce(l.duration_min, 60) <> 60 then
    rate := round(rate * l.duration_min / 60.0, 2);
  end if;

  insert into public.lesson_pay (lesson_id, teacher_id, amount, currency, month)
  values (l.id, l.teacher_id, coalesce(rate, 0), coalesce(rate_currency, 'UAH'),
          date_trunc('month', l.starts_at)::date)
  on conflict (lesson_id) do update
    set amount = excluded.amount, currency = excluded.currency,
        month = excluded.month, teacher_id = excluded.teacher_id;
end
$$;

revoke execute on function public.write_lesson_pay(uuid) from public, anon, authenticated;

-- lessons of these kinds already held get their pay line
do $$
declare x record;
begin
  for x in select id from public.lessons where kind in ('trial', 'diagnostic') and status = 'done' loop
    perform public.write_lesson_pay(x.id);
  end loop;
end $$;
