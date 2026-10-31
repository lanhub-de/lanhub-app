-- Some teachers are paid by the size of the student's package:
-- B1+ is 420 for an 8-lesson package and 460 for a 12-lesson package.
alter table public.teacher_rates
  add column package_lessons int check (package_lessons > 0);

drop index public.teacher_rates_unique;
create unique index teacher_rates_unique
  on public.teacher_rates (teacher_id, kind, band, market, package_lessons, student_id, group_id, valid_from)
  nulls not distinct;

-- Most specific rule wins: own student or group, then market, then package
-- size, then level band, then the newest date.
create or replace function public.lessons_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rate numeric;
  rate_currency text;
  stu_market text;
  pkg_size int;
begin
  if public.is_counted(new.status) then
    select market into stu_market from public.students where id = new.student_id;
    select lessons_total into pkg_size from public.packages where id = new.package_id;

    select tr.amount, tr.currency into rate, rate_currency
      from public.teacher_rates tr
     where tr.teacher_id = new.teacher_id
       and tr.kind = new.kind
       and tr.valid_from <= new.starts_at::date
       and (tr.band is null or tr.band = new.band)
       and (tr.market is null or tr.market = stu_market)
       and (tr.package_lessons is null or tr.package_lessons = pkg_size)
       and (tr.student_id is null or tr.student_id = new.student_id)
       and (tr.group_id is null or tr.group_id = new.group_id)
     order by (tr.student_id is not null or tr.group_id is not null) desc,
              (tr.market is not null) desc,
              (tr.package_lessons is not null) desc,
              (tr.band is not null) desc,
              tr.valid_from desc
     limit 1;

    insert into public.lesson_pay (lesson_id, teacher_id, amount, currency, month)
    values (new.id, new.teacher_id, coalesce(rate, 0), coalesce(rate_currency, 'UAH'),
            date_trunc('month', new.starts_at)::date)
    on conflict (lesson_id) do update
      set amount = excluded.amount, currency = excluded.currency,
          month = excluded.month, teacher_id = excluded.teacher_id;
  else
    delete from public.lesson_pay where lesson_id = new.id;
  end if;

  -- Force majeure extends the student's current package.
  if new.status = 'force_majeure' and new.student_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'force_majeure') then
    update public.packages p
       set extra_days = p.extra_days + public.force_majeure_extension_days()
     where p.id = (select p2.id from public.packages p2
                    where p2.student_id = new.student_id and p2.status = 'active'
                    order by p2.created_at limit 1);
  end if;

  -- Keep each touched package's first lesson date and status right.
  if new.package_id is not null or (tg_op = 'UPDATE' and old.package_id is not null) then
    update public.packages p
       set first_lesson_at = (select min(l.starts_at) from public.lessons l
                               where l.package_id = p.id and public.is_counted(l.status)),
           status = case
             when (select count(*) from public.lessons l
                    where l.package_id = p.id and public.is_counted(l.status)) >= p.lessons_total
               then 'finished' else 'active' end
     where p.id in (new.package_id, case when tg_op = 'UPDATE' then old.package_id end)
       and p.status <> 'cancelled';
  end if;

  return null;
end
$$;

revoke execute on function public.lessons_after_write() from public, anon, authenticated;
