-- Group pay that depends on how many students came, and fixed monthly extras
-- such as the teacher's Zoom.

-- ---------------------------------------------------------------------------
-- Group pay by attendance
-- ---------------------------------------------------------------------------
-- A rate can have steps: from this many students present, this amount.
-- Agata's group rate is 600 with steps 3 -> 750, 4 -> 900, 5 -> 1050,
-- 6 -> 1200. A rate without steps pays the same however many came.
create table public.rate_steps (
  rate_id uuid not null references public.teacher_rates (id) on delete cascade,
  min_present int not null check (min_present > 1),
  amount numeric(12, 2) not null check (amount >= 0),
  primary key (rate_id, min_present)
);

alter table public.rate_steps enable row level security;

create policy rate_steps_select on public.rate_steps for select using (
  exists (select 1 from public.teacher_rates tr where tr.id = rate_id
           and (public.has_role('owner') or tr.teacher_id = auth.uid()))
);
create policy rate_steps_write on public.rate_steps for all
  using (public.has_role('owner')) with check (public.has_role('owner'));

grant select, insert, update, delete on public.rate_steps to authenticated;
revoke all on public.rate_steps from anon;

-- Present = the group's members minus those marked absent.
create function public.lesson_present(lid uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when l.group_id is null then null else
    (select count(*) from public.group_members m where m.group_id = l.group_id)::int
    - (select count(*) from public.lesson_absences a
        join public.group_members m on m.student_id = a.student_id and m.group_id = l.group_id
       where a.lesson_id = l.id)::int
  end
  from public.lessons l where l.id = lid
$$;

-- The pay line of one lesson, from the rate rules. Most specific rule wins:
-- own student or group, then market, then package size, then level band,
-- then the newest. Then the highest attendance step that was reached.
create function public.write_lesson_pay(lid uuid) returns void
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

  if not public.is_counted(l.status) then
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

create or replace function public.lessons_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_lesson_pay(new.id);

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

-- Marking someone absent (or present again) after the lesson was marked
-- changes the pay. A paid-out month stays locked for everyone but the owner.
create function public.absences_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lid uuid := coalesce(new.lesson_id, old.lesson_id);
  l public.lessons;
begin
  select * into l from public.lessons where id = lid;
  if l.id is null then return null; end if;
  if public.current_app_role() is distinct from 'owner' and exists (
       select 1 from public.payout_reviews pr
        where pr.teacher_id = l.teacher_id
          and pr.month = date_trunc('month', l.starts_at)::date
          and pr.status = 'paid') then
    raise exception 'This month is already paid out and locked' using errcode = 'P0001';
  end if;
  perform public.write_lesson_pay(lid);
  return null;
end
$$;

revoke execute on function public.absences_after_write() from public, anon, authenticated;

create trigger absences_after_write
  after insert or delete on public.lesson_absences
  for each row execute function public.absences_after_write();

-- ---------------------------------------------------------------------------
-- Monthly extras (Zoom and the like)
-- ---------------------------------------------------------------------------
-- Added to the teacher's payout every month from starts_on until ends_on.
-- An amount in euros is converted at the NBU rate when the month's line is
-- written (the app does that, the database cannot fetch rates).
create table public.teacher_allowances (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'UAH' check (currency in ('UAH', 'EUR', 'USD')),
  starts_on date not null default date_trunc('month', now())::date check (extract(day from starts_on) = 1),
  ends_on date,
  created_at timestamptz not null default now()
);

alter table public.teacher_allowances enable row level security;

create policy teacher_allowances_owner on public.teacher_allowances for all
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy teacher_allowances_own on public.teacher_allowances for select
  using (teacher_id = auth.uid());

grant select, insert, update, delete on public.teacher_allowances to authenticated;
revoke all on public.teacher_allowances from anon;

alter table public.payout_adjustments
  add column allowance_id uuid references public.teacher_allowances (id) on delete set null;
create unique index payout_adjustments_allowance_month
  on public.payout_adjustments (allowance_id, month) where allowance_id is not null;

-- Invites carry them too, like the rates.
alter table public.invites add column pending_allowances jsonb not null default '[]'::jsonb;

create or replace function public.accept_invite(uid uuid, user_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  r jsonb;
  st jsonb;
  rid uuid;
begin
  select * into inv from public.invites
   where email = lower(user_email) and accepted_at is null;
  if not found or exists (select 1 from public.profiles where id = uid) then
    return;
  end if;

  insert into public.profiles (id, full_name, email, role, locale)
  values (uid, inv.full_name, inv.email, inv.role, inv.locale);

  if inv.role in ('teacher', 'head_teacher', 'owner') then
    insert into public.teacher_settings (teacher_id) values (uid) on conflict do nothing;
  end if;

  for r in select * from jsonb_array_elements(inv.pending_rates) loop
    rid := null;
    insert into public.teacher_rates (teacher_id, kind, band, market, package_lessons, amount, valid_from)
    values (uid,
            (r ->> 'kind')::public.lesson_kind,
            (r ->> 'band')::public.level_band,
            r ->> 'market',
            (r ->> 'package_lessons')::int,
            (r ->> 'amount')::numeric,
            coalesce((r ->> 'valid_from')::date, date '2026-09-01'))
    on conflict do nothing
    returning id into rid;
    if rid is not null then
      for st in select * from jsonb_array_elements(coalesce(r -> 'steps', '[]'::jsonb)) loop
        insert into public.rate_steps (rate_id, min_present, amount)
        values (rid, (st ->> 'min_present')::int, (st ->> 'amount')::numeric);
      end loop;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(inv.pending_allowances) loop
    insert into public.teacher_allowances (teacher_id, label, amount, currency, starts_on)
    values (uid, r ->> 'label', (r ->> 'amount')::numeric, coalesce(r ->> 'currency', 'UAH'),
            coalesce((r ->> 'starts_on')::date, date_trunc('month', now())::date));
  end loop;

  update public.invites set accepted_at = now() where email = inv.email;
end
$$;

revoke execute on function public.accept_invite(uuid, text) from public, anon, authenticated;

revoke execute on function public.lesson_present(uuid) from public, anon;
grant execute on function public.lesson_present(uuid) to authenticated;
