-- Renewal bonus: when a student buys the next package, her teacher gets a
-- one-off line in the payout. The school sets it per teacher (and market) by
-- package size: from 4 lessons, from 8, from 12. The first package never
-- counts, and neither does a student the teacher has not taught yet. The line
-- is an ordinary extra line: the owner can remove it.

create table public.renewal_bonus_rules (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  market text check (market in ('ua', 'intl')),        -- null: any student
  min_lessons int not null check (min_lessons > 0),    -- package size from
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'UAH',
  valid_from date not null default current_date,
  created_at timestamptz not null default now()
);
create unique index renewal_bonus_rules_unique
  on public.renewal_bonus_rules (teacher_id, market, min_lessons, valid_from) nulls not distinct;

alter table public.renewal_bonus_rules enable row level security;
create policy renewal_bonus_rules_owner on public.renewal_bonus_rules for all
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy renewal_bonus_rules_own on public.renewal_bonus_rules for select
  using (teacher_id = auth.uid());
revoke all on public.renewal_bonus_rules from anon;
grant select, insert, update, delete on public.renewal_bonus_rules to authenticated;

alter table public.payout_adjustments
  add column package_id uuid references public.packages (id) on delete set null;
create unique index payout_adjustments_package
  on public.payout_adjustments (package_id) where package_id is not null;

-- The bonus for a package of this size: the biggest step it reaches, the
-- newest version of that step.
create function public.renewal_bonus_amount(tid uuid, stu_market text, lessons int, on_day date)
returns table (amount numeric, currency text)
language sql stable security definer set search_path = public as $$
  select r.amount, r.currency
    from public.renewal_bonus_rules r
   where r.teacher_id = tid
     and (r.market is null or r.market = stu_market)
     and r.min_lessons <= lessons
     and r.valid_from <= on_day
   order by r.min_lessons desc, (r.market is not null) desc, r.valid_from desc
   limit 1
$$;

create function public.payout_is_paid(tid uuid, m date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payout_reviews pr
                  where pr.teacher_id = tid and pr.month = m and pr.status = 'paid')
$$;

create function public.renewal_bonus_label(tid uuid, student text, lessons int) returns text
language sql stable security definer set search_path = public as $$
  select case when (select locale from public.profiles where id = tid) = 'uk'
              then 'Бонус за продовження · ' || student || ' · пакет ' || lessons
              else 'Renewal bonus · ' || student || ' · package of ' || lessons end
$$;

create function public.packages_renewal_bonus() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.students;
  line public.payout_adjustments;
  bonus record;
  day date;
  m date;
begin
  select * into s from public.students where id = new.student_id;

  if tg_op = 'INSERT' then
    if s.teacher_id is null or new.status = 'cancelled' then return null; end if;
    -- a renewal: the student already had a package ...
    if not exists (select 1 from public.packages o
                    where o.student_id = new.student_id and o.id <> new.id
                      and o.status <> 'cancelled' and o.created_at <= new.created_at) then
      return null;
    end if;
    -- ... and has had lessons with this teacher
    if not exists (select 1 from public.lessons l
                    where l.student_id = new.student_id and l.teacher_id = s.teacher_id
                      and l.kind = 'individual' and l.status = 'done') then
      return null;
    end if;

    day := (new.created_at at time zone 'Europe/Kyiv')::date;
    select * into bonus from public.renewal_bonus_amount(s.teacher_id, s.market, new.lessons_total, day);
    if bonus.amount is null or bonus.amount = 0 then return null; end if;

    -- a month already paid out stays as it is: the bonus goes into the next one
    m := date_trunc('month', day)::date;
    while public.payout_is_paid(s.teacher_id, m) loop
      m := (m + interval '1 month')::date;
    end loop;

    insert into public.payout_adjustments (teacher_id, month, description, amount, currency, package_id)
    values (s.teacher_id, m, public.renewal_bonus_label(s.teacher_id, s.full_name, new.lessons_total),
            bonus.amount, bonus.currency, new.id);
    return null;
  end if;

  -- A package changed size or was cancelled: its bonus line follows, unless
  -- the owner removed the line or that month is already paid out.
  if (new.status = 'cancelled' and old.status <> 'cancelled')
     or new.lessons_total is distinct from old.lessons_total then
    select * into line from public.payout_adjustments where package_id = new.id;
    if line.id is null or public.payout_is_paid(line.teacher_id, line.month) then return null; end if;

    day := (new.created_at at time zone 'Europe/Kyiv')::date;
    select * into bonus from public.renewal_bonus_amount(line.teacher_id, s.market, new.lessons_total, day);
    if new.status = 'cancelled' or bonus.amount is null or bonus.amount = 0 then
      delete from public.payout_adjustments where id = line.id;
    else
      update public.payout_adjustments
         set amount = bonus.amount, currency = bonus.currency,
             description = public.renewal_bonus_label(line.teacher_id, s.full_name, new.lessons_total)
       where id = line.id;
    end if;
  end if;
  return null;
end
$$;

create trigger packages_renewal_bonus after insert or update on public.packages
  for each row execute function public.packages_renewal_bonus();

-- A deleted package takes its bonus line with it (a paid month stays).
create function public.packages_drop_bonus() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.payout_adjustments a
   where a.package_id = old.id and not public.payout_is_paid(a.teacher_id, a.month);
  return old;
end
$$;

create trigger packages_drop_bonus before delete on public.packages
  for each row execute function public.packages_drop_bonus();

revoke execute on function public.renewal_bonus_amount(uuid, text, int, date) from public, anon, authenticated;
revoke execute on function public.payout_is_paid(uuid, date) from public, anon, authenticated;
revoke execute on function public.renewal_bonus_label(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.packages_renewal_bonus() from public, anon, authenticated;
revoke execute on function public.packages_drop_bonus() from public, anon, authenticated;
