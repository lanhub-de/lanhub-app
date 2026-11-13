-- School policy: a teacher is paid only for lessons actually held.
-- A no-show, a late cancellation, an in-time cancellation, force majeure or a
-- moved lesson adds nothing to her pay, and neither does a group lesson every
-- member was marked absent from. The student's package is unchanged: a no-show and a late
-- cancellation still use up a lesson there (is_counted).

create or replace function public.is_paid(s public.lesson_status) returns boolean
language sql immutable set search_path = public as $$
  select s = 'done'
$$;

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

-- Pay lines that no longer qualify go: not held, nobody present, or from
-- before the platform took over pay (those months were paid outside it).
delete from public.lesson_pay lp
 using public.lessons l
 where l.id = lp.lesson_id
   and (not public.is_paid(l.status)
        or l.starts_at < public.pay_start()
        or (l.group_id is not null and coalesce(public.lesson_present(l.id), 1) < 1
            and exists (select 1 from public.group_members m where m.group_id = l.group_id)));

delete from public.payout_reviews where month < date_trunc('month', public.pay_start() at time zone 'Europe/Kyiv')::date;
