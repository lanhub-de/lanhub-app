-- LanHub platform, stage 1: people and roles, students, groups, packages,
-- teacher rates, lesson journal, payouts, library.
-- Access rules live in the database (row level security), not only in the UI.
--
-- School rules built in (from the LanHub "Правила занять" card):
--   * a package is valid 1 month from the first lesson; unused lessons expire;
--   * cancelling at least 24 h before (per teacher) does not count;
--   * a later cancellation or a no-show counts as a lesson held;
--   * force majeure: the lesson is moved and the package is extended.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'head_teacher', 'manager', 'teacher', 'student');
create type public.app_locale as enum ('uk', 'en');
create type public.lesson_kind as enum ('individual', 'pair', 'group', 'club', 'trial', 'diagnostic');
-- A = A0-A2, B = B1 and above. Rates differ by band.
create type public.level_band as enum ('A', 'B');
create type public.lesson_status as enum (
  'scheduled',
  'done',           -- held
  'no_show',        -- student did not come: counts as held
  'late_cancel',    -- cancelled later than the teacher's limit: counts as held
  'cancelled',      -- cancelled in time, or an exception: does not count
  'force_majeure',  -- does not count, the package is extended
  'rescheduled'     -- moved to another time: does not count
);
create type public.payout_status as enum ('draft', 'checked', 'paid');

-- Statuses that take a lesson from the package and are paid to the teacher.
create function public.is_counted(s public.lesson_status) returns boolean
language sql immutable as $$
  select s in ('done', 'no_show', 'late_cancel')
$$;

-- Days a package is extended for each force majeure lesson.
create function public.force_majeure_extension_days() returns int
language sql immutable as $$ select 7 $$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create sequence public.viewer_code_seq start 1;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.app_role not null,
  locale public.app_locale not null default 'uk',
  -- Short code printed in the corner of library pages, e.g. LH-07.
  viewer_code text not null unique
    default ('LH-' || lpad(nextval('public.viewer_code_seq')::text, 2, '0')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Each teacher's own numbers from their rules card.
create table public.teacher_settings (
  teacher_id uuid primary key references public.profiles (id) on delete cascade,
  cancel_hours int not null default 24 check (cancel_hours between 0 and 168),
  homework_hours int not null default 24 check (homework_hours between 0 and 168)
);

-- Helpers. Security definer so they can read profiles without tripping
-- the profiles policies themselves.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create function public.level_to_band(level text) returns public.level_band
language sql immutable as $$
  select case
    when level is null then null
    when upper(level) like 'A%' then 'A'::public.level_band
    else 'B'::public.level_band
  end
$$;

-- ---------------------------------------------------------------------------
-- Students and groups
-- ---------------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  contact text,                       -- Telegram, phone
  locale public.app_locale not null default 'uk',
  market text not null default 'ua' check (market in ('ua', 'intl')),
  level text,                         -- A0, A1, A2, B1, B2, C1
  teacher_id uuid references public.profiles (id),
  profile_id uuid unique references public.profiles (id),  -- own login, stage 3
  status text not null default 'active' check (status in ('active', 'paused', 'left')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Groups, pairs and the speaking club.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text,
  kind public.lesson_kind not null default 'group' check (kind in ('pair', 'group', 'club')),
  teacher_id uuid references public.profiles (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  primary key (group_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Packages and student payments (money kept apart so the head teacher,
-- who sees packages, does not see prices)
-- ---------------------------------------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  lessons_total int not null check (lessons_total > 0),
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  validity_months int not null default 1 check (validity_months > 0),
  first_lesson_at timestamptz,        -- set by the first counted lesson
  extra_days int not null default 0 check (extra_days >= 0),  -- force majeure, manual
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create function public.package_valid_until(p public.packages) returns timestamptz
language sql stable as $$
  select case when p.first_lesson_at is null then null
    else p.first_lesson_at + make_interval(months => p.validity_months, days => p.extra_days) end
$$;

create table public.student_payments (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'UAH',
  method text,                        -- WayForPay, monobank, cash
  paid_at date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Teacher rates. A rule matches a lesson when every filled-in filter matches;
-- the most specific rule wins: a student or group of its own, then market,
-- then level band, then the newest date.
-- ---------------------------------------------------------------------------
create table public.teacher_rates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  kind public.lesson_kind not null,
  band public.level_band,
  market text check (market in ('ua', 'intl')),
  student_id uuid references public.students (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'UAH',
  valid_from date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create unique index teacher_rates_unique
  on public.teacher_rates (teacher_id, kind, band, market, student_id, group_id, valid_from)
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- Lesson journal
-- ---------------------------------------------------------------------------
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id),
  student_id uuid references public.students (id),
  group_id uuid references public.groups (id),
  kind public.lesson_kind not null default 'individual',
  band public.level_band,
  starts_at timestamptz not null,
  duration_min int not null default 60 check (duration_min > 0),
  status public.lesson_status not null default 'scheduled',
  note text,
  zoom_url text,
  package_id uuid references public.packages (id),
  marked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(student_id, group_id) = 1)
);
create index lessons_teacher_time on public.lessons (teacher_id, starts_at);
create index lessons_student_time on public.lessons (student_id, starts_at);
create index lessons_package on public.lessons (package_id);

-- Pay for a lesson lives apart from the lesson, so only the owner and the
-- teacher who taught it can see the amount.
create table public.lesson_pay (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id),
  amount numeric(12, 2) not null,
  currency text not null default 'UAH',
  month date not null                 -- first day of the month of the lesson
);

-- Extra lines in a payout that are not lessons: Zoom compensation,
-- GoodNotes, a fixed fee.
create table public.payout_adjustments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id),
  month date not null check (extract(day from month) = 1),
  description text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'UAH',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payout_reviews (
  teacher_id uuid not null references public.profiles (id),
  month date not null check (extract(day from month) = 1),
  status public.payout_status not null default 'draft',
  updated_at timestamptz not null default now(),
  primary key (teacher_id, month)
);

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------
create table public.library_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.library_folders (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null unique,
  mime text not null default 'application/pdf',
  -- library: school library, private: a teacher's own file for a lesson
  visibility text not null default 'library' check (visibility in ('library', 'private')),
  folder_id uuid references public.library_folders (id) on delete set null,
  level text,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  suggested_for_library boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.lesson_files (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  primary key (lesson_id, file_id)
);

create table public.file_access_log (
  id bigint generated always as identity primary key,
  file_id uuid not null references public.files (id) on delete cascade,
  profile_id uuid not null default auth.uid() references public.profiles (id),
  opened_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Business rules (triggers)
-- ---------------------------------------------------------------------------

-- Kind and band come from the student or group, not from what a teacher
-- types. A month already paid out is locked for everyone but the owner.
create function public.lessons_before_write() returns trigger
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

  -- A counted individual lesson takes a seat from the student's oldest
  -- active package that has lessons left and has not expired.
  if public.is_counted(new.status) and new.student_id is not null and new.package_id is null
     and new.kind in ('individual') then
    select p.id into new.package_id
      from public.packages p
     where p.student_id = new.student_id
       and p.status = 'active'
       and (p.first_lesson_at is null or public.package_valid_until(p) >= new.starts_at)
       and (select count(*) from public.lessons l
             where l.package_id = p.id and public.is_counted(l.status)
               and l.id <> new.id) < p.lessons_total
     order by p.created_at
     limit 1;
  end if;

  return new;
end
$$;

create trigger lessons_before_write
  before insert or update on public.lessons
  for each row execute function public.lessons_before_write();

-- Pay is written by the system from the rate rules, never typed by hand.
create function public.lessons_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rate numeric;
  rate_currency text;
  stu_market text;
begin
  if public.is_counted(new.status) then
    select market into stu_market from public.students where id = new.student_id;

    select tr.amount, tr.currency into rate, rate_currency
      from public.teacher_rates tr
     where tr.teacher_id = new.teacher_id
       and tr.kind = new.kind
       and tr.valid_from <= new.starts_at::date
       and (tr.band is null or tr.band = new.band)
       and (tr.market is null or tr.market = stu_market)
       and (tr.student_id is null or tr.student_id = new.student_id)
       and (tr.group_id is null or tr.group_id = new.group_id)
     order by (tr.student_id is not null or tr.group_id is not null) desc,
              (tr.market is not null) desc,
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

create trigger lessons_after_write
  after insert or update on public.lessons
  for each row execute function public.lessons_after_write();

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
create view public.package_usage with (security_invoker = true) as
with used as (
  select p.*, (select count(*) from public.lessons l
                where l.package_id = p.id and public.is_counted(l.status))::int as lessons_used
    from public.packages p
)
select u.id as package_id, u.student_id, u.lessons_total, u.lessons_used,
       u.lessons_total - u.lessons_used as lessons_left,
       u.first_lesson_at,
       u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) as valid_until,
       case
         when u.status = 'active'
          and u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) < now()
           then 'expired'
         else u.status
       end as status
  from used u;

-- Students with no package that is still usable: the "did not renew" list
-- from the June notes.
create view public.students_not_renewed with (security_invoker = true) as
select s.id as student_id, s.full_name, s.level, s.teacher_id,
       max(pu.valid_until) as last_valid_until
  from public.students s
  join public.package_usage pu on pu.student_id = s.id
 where s.status = 'active'
 group by s.id
having bool_and(pu.status <> 'active');

create view public.monthly_payouts with (security_invoker = true) as
with lines as (
  select teacher_id, month, amount, currency, 1 as lessons from public.lesson_pay
  union all
  select teacher_id, month, amount, currency, 0 from public.payout_adjustments
)
select l.teacher_id, pr.full_name as teacher_name, l.month, l.currency,
       sum(l.lessons)::int as lessons_count,
       sum(l.amount) as total,
       coalesce(rv.status, 'draft') as review_status
  from lines l
  join public.profiles pr on pr.id = l.teacher_id
  left join public.payout_reviews rv on rv.teacher_id = l.teacher_id and rv.month = l.month
 group by l.teacher_id, pr.full_name, l.month, l.currency, rv.status;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.teacher_settings enable row level security;
alter table public.students enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.packages enable row level security;
alter table public.student_payments enable row level security;
alter table public.teacher_rates enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_pay enable row level security;
alter table public.payout_adjustments enable row level security;
alter table public.payout_reviews enable row level security;
alter table public.library_folders enable row level security;
alter table public.files enable row level security;
alter table public.lesson_files enable row level security;
alter table public.file_access_log enable row level security;

-- A teacher "has" a student when the student is assigned to them, sits in
-- one of their groups, or had a lesson with them (a substitution).
create function public.teaches_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = sid and s.teacher_id = auth.uid())
      or exists (select 1 from public.group_members gm
                   join public.groups g on g.id = gm.group_id
                  where gm.student_id = sid and g.teacher_id = auth.uid())
      or exists (select 1 from public.lessons l where l.student_id = sid and l.teacher_id = auth.uid())
$$;

-- profiles
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or public.has_role('owner', 'head_teacher', 'manager')
);
create policy profiles_owner_write on public.profiles for all
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- teacher settings
create policy teacher_settings_select on public.teacher_settings for select using (
  teacher_id = auth.uid() or public.has_role('owner', 'head_teacher', 'manager')
);
create policy teacher_settings_write on public.teacher_settings for all
  using (teacher_id = auth.uid() or public.has_role('owner'))
  with check (teacher_id = auth.uid() or public.has_role('owner'));

-- students
create policy students_select on public.students for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or (public.has_role('teacher') and public.teaches_student(id))
  or profile_id = auth.uid()
);
create policy students_insert on public.students for insert
  with check (public.has_role('owner', 'head_teacher', 'manager'));
create policy students_update on public.students for update
  using (public.has_role('owner', 'head_teacher', 'manager'))
  with check (public.has_role('owner', 'head_teacher', 'manager'));
create policy students_delete on public.students for delete
  using (public.has_role('owner'));

-- groups and members
create policy groups_select on public.groups for select using (
  public.has_role('owner', 'head_teacher', 'manager') or teacher_id = auth.uid()
);
create policy groups_write on public.groups for all
  using (public.has_role('owner', 'head_teacher', 'manager'))
  with check (public.has_role('owner', 'head_teacher', 'manager'));
create policy group_members_select on public.group_members for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or exists (select 1 from public.groups g where g.id = group_id and g.teacher_id = auth.uid())
);
create policy group_members_write on public.group_members for all
  using (public.has_role('owner', 'head_teacher', 'manager'))
  with check (public.has_role('owner', 'head_teacher', 'manager'));

-- packages: everyone who works with the student sees how many lessons are
-- left; owner and managers create them and can extend them by hand.
create policy packages_select on public.packages for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or (public.has_role('teacher') and public.teaches_student(student_id))
  or exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid())
);
create policy packages_write on public.packages for all
  using (public.has_role('owner', 'manager'))
  with check (public.has_role('owner', 'manager'));

-- student payments: owner and managers only
create policy student_payments_all on public.student_payments for all
  using (public.has_role('owner', 'manager'))
  with check (public.has_role('owner', 'manager'));

-- teacher rates: owner manages; a teacher sees own rates
create policy teacher_rates_select on public.teacher_rates for select using (
  public.has_role('owner') or teacher_id = auth.uid()
);
create policy teacher_rates_write on public.teacher_rates for all
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- lessons
create policy lessons_select on public.lessons for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or teacher_id = auth.uid()
  or exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid())
);
create policy lessons_insert on public.lessons for insert with check (
  public.has_role('owner', 'head_teacher', 'manager')
  or (public.has_role('teacher') and teacher_id = auth.uid()
      and (student_id is null or exists (select 1 from public.students s
                                          where s.id = student_id and s.teacher_id = auth.uid())
           or exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
                       where gm.student_id = lessons.student_id and g.teacher_id = auth.uid()))
      and (group_id is null or exists (select 1 from public.groups g
                                        where g.id = group_id and g.teacher_id = auth.uid())))
);
create policy lessons_update on public.lessons for update
  using (public.has_role('owner', 'head_teacher', 'manager') or teacher_id = auth.uid())
  with check (public.has_role('owner', 'head_teacher', 'manager') or teacher_id = auth.uid());
create policy lessons_delete on public.lessons for delete
  using (public.has_role('owner', 'manager'));

-- lesson pay: written only by the trigger
create policy lesson_pay_select on public.lesson_pay for select using (
  public.has_role('owner') or teacher_id = auth.uid()
);

create policy payout_adjustments_select on public.payout_adjustments for select using (
  public.has_role('owner') or teacher_id = auth.uid()
);
create policy payout_adjustments_write on public.payout_adjustments for all
  using (public.has_role('owner')) with check (public.has_role('owner'));

create policy payout_reviews_select on public.payout_reviews for select using (
  public.has_role('owner') or teacher_id = auth.uid()
);
create policy payout_reviews_write on public.payout_reviews for all
  using (public.has_role('owner')) with check (public.has_role('owner'));

-- library
create policy library_folders_select on public.library_folders for select using (
  public.has_role('owner', 'head_teacher', 'teacher')
);
create policy library_folders_write on public.library_folders for all
  using (public.has_role('owner', 'head_teacher'))
  with check (public.has_role('owner', 'head_teacher'));

create policy files_select on public.files for select using (
  (visibility = 'library' and public.has_role('owner', 'head_teacher', 'teacher'))
  or uploaded_by = auth.uid()
  or public.has_role('owner', 'head_teacher')
  or exists (select 1 from public.lesson_files lf
               join public.lessons l on l.id = lf.lesson_id
              where lf.file_id = files.id
                and (l.teacher_id = auth.uid()
                     or exists (select 1 from public.students s
                                 where s.id = l.student_id and s.profile_id = auth.uid())))
);
create policy files_insert on public.files for insert with check (
  uploaded_by = auth.uid() and (
    public.has_role('owner', 'head_teacher')
    or (public.has_role('teacher') and visibility = 'private')
  )
);
create policy files_update on public.files for update
  using (public.has_role('owner', 'head_teacher') or uploaded_by = auth.uid())
  with check (public.has_role('owner', 'head_teacher')
              or (uploaded_by = auth.uid() and visibility = 'private'));
create policy files_delete on public.files for delete
  using (public.has_role('owner', 'head_teacher') or uploaded_by = auth.uid());

create policy lesson_files_select on public.lesson_files for select using (
  exists (select 1 from public.lessons l where l.id = lesson_id)  -- inherits lessons RLS
);
create policy lesson_files_write on public.lesson_files for all
  using (exists (select 1 from public.lessons l where l.id = lesson_id
                  and (l.teacher_id = auth.uid() or public.has_role('owner', 'head_teacher'))))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id
                  and (l.teacher_id = auth.uid() or public.has_role('owner', 'head_teacher'))));

create policy file_access_log_insert on public.file_access_log for insert
  with check (profile_id = auth.uid());
create policy file_access_log_select on public.file_access_log for select
  using (public.has_role('owner', 'head_teacher'));

-- ---------------------------------------------------------------------------
-- Privileges: logged-in users work through RLS; anonymous users get nothing.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- self-update of a profile: name and language only
revoke update on public.profiles from authenticated;
grant update (full_name, locale) on public.profiles to authenticated;
-- marked_at is set by the system
revoke update on public.lessons from authenticated;
grant update (teacher_id, student_id, group_id, kind, starts_at, duration_min,
              status, note, zoom_url, package_id) on public.lessons to authenticated;
-- first_lesson_at is set by the system
revoke update on public.packages from authenticated;
grant update (lessons_total, status, validity_months, extra_days, note) on public.packages to authenticated;
-- pay is written by the trigger only
revoke insert, update, delete on public.lesson_pay from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
