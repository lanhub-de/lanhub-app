-- Teachers' lessons from before the platform took over pay were paid outside
-- it. When their history is brought in (so packages count right), those
-- lessons get no pay line. The start is a setting (private.settings
-- 'pay_start', a date); without it every counted lesson is paid as before.
create function public.pay_start() returns timestamptz
language sql stable security definer set search_path = public, private as $$
  select coalesce((select (value::date)::timestamp at time zone 'Europe/Kyiv' from private.settings where key = 'pay_start'),
                  '-infinity'::timestamptz)
$$;
revoke execute on function public.pay_start() from public, anon, authenticated;

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

  -- lessons before the platform took over pay (paid outside it) get no pay
  if not public.is_counted(l.status) or l.pending_teacher is not null or l.starts_at < public.pay_start() then
    delete from public.lesson_pay where lesson_id = l.id;
    return;
  end if;

  select market into stu_market from public.students where id = l.student_id;
  select lessons_total into pkg_size from public.packages where id = l.package_id;
  present := public.lesson_present(l.id);

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

  insert into public.lesson_pay (lesson_id, teacher_id, amount, currency, month)
  values (l.id, l.teacher_id, coalesce(rate, 0), coalesce(rate_currency, 'UAH'),
          date_trunc('month', l.starts_at)::date)
  on conflict (lesson_id) do update
    set amount = excluded.amount, currency = excluded.currency,
        month = excluded.month, teacher_id = excluded.teacher_id;
end
$$;

revoke execute on function public.write_lesson_pay(uuid) from public, anon, authenticated;
