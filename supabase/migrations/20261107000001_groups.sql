-- Group learning: a flow's program is written once (lessons, rule, what to
-- prepare, homework, vocabulary, files); every group on that flow gets it.
-- A new group gets its lessons scheduled automatically, and a group that
-- finishes a flow can continue into the next one with the same people.

-- ---------------------------------------------------------------------------
-- Programs
-- ---------------------------------------------------------------------------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,                              -- 'German Activation · Flow 3'
  level text,                                       -- 'A2–B1'
  lesson_minutes int not null default 90 check (lesson_minutes > 0),
  next_program_id uuid references public.programs (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.program_lessons (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  n int not null check (n > 0),
  title text not null,
  rule text,                -- the rule in one question
  prepare text,             -- what to prepare before class
  homework_url text,        -- ClassMarker
  vocab_url text,           -- Quizlet or our own cards
  teacher_note text,        -- for teachers only
  unique (program_id, n)
);

-- Course guides for the whole flow, and files for one lesson. A file that is
-- not for students (a teacher guide) is marked so.
create table public.program_files (
  program_id uuid not null references public.programs (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  for_students boolean not null default true,
  primary key (program_id, file_id)
);

create table public.program_lesson_files (
  program_lesson_id uuid not null references public.program_lessons (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  for_students boolean not null default true,
  primary key (program_lesson_id, file_id)
);

-- ---------------------------------------------------------------------------
-- Groups get a program and a timetable
-- ---------------------------------------------------------------------------
alter table public.groups
  add column program_id uuid references public.programs (id),
  add column days int[] check (days <@ array[1, 2, 3, 4, 5, 6, 7]),   -- ISO weekdays, Monday = 1
  add column start_time time,
  add column tz text not null default 'Europe/Vienna',
  add column start_date date,
  add column capacity int check (capacity > 0),
  add column zoom_url text,
  add column continued_from uuid references public.groups (id) on delete set null;

alter table public.group_members add column joined_at timestamptz not null default now();

alter table public.lessons
  add column program_lesson_id uuid references public.program_lessons (id) on delete set null,
  add column recording_url text,
  add column homework_url text;   -- this lesson only; otherwise the program's link

grant update (program_lesson_id, recording_url, homework_url) on public.lessons to authenticated;

-- A teacher may add a recording or homework link, but the lesson's place in
-- the program is set by the school.
create function public.lessons_keep_program() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() = 'teacher' then
    new.program_lesson_id := old.program_lesson_id;
  end if;
  return new;
end $$;
create trigger lessons_keep_program before update on public.lessons
  for each row execute function public.lessons_keep_program();

-- Who missed a group lesson. Everyone else in the group was there.
create table public.lesson_absences (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  marked_by uuid default auth.uid(),
  primary key (lesson_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
-- One lesson per program lesson, on the group's weekdays, from the start date,
-- at the group's local time.
create function public.schedule_group(gid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  g public.groups;
  pl record;
  d date;
  minutes int;
  made int := 0;
begin
  if not public.has_role('owner', 'head_teacher', 'manager') then
    raise exception 'Only the school can schedule a group';
  end if;
  select * into g from public.groups where id = gid;
  if g.id is null then raise exception 'No such group'; end if;
  if g.program_id is null or g.teacher_id is null or g.days is null or cardinality(g.days) = 0
     or g.start_time is null or g.start_date is null then
    raise exception 'A group needs a program, a teacher, days, a time and a start date';
  end if;
  if exists (select 1 from public.lessons where group_id = gid) then
    raise exception 'This group already has lessons';
  end if;
  select lesson_minutes into minutes from public.programs where id = g.program_id;
  d := g.start_date;
  for pl in select id from public.program_lessons where program_id = g.program_id order by n loop
    while not (extract(isodow from d)::int = any (g.days)) loop
      d := d + 1;
    end loop;
    insert into public.lessons (teacher_id, group_id, kind, starts_at, duration_min, zoom_url, program_lesson_id)
    values (g.teacher_id, gid, g.kind, (d + g.start_time) at time zone g.tz, minutes, g.zoom_url, pl.id);
    made := made + 1;
    d := d + 1;
  end loop;
  return made;
end $$;

-- A new group on a program, scheduled in one go.
create function public.create_group(
  p_program uuid, p_teacher uuid, p_days int[], p_time time, p_start date,
  p_capacity int default 10, p_zoom text default null, p_name text default null,
  p_tz text default 'Europe/Vienna'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pr public.programs;
  gid uuid;
  wd text[] := array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  label text;
begin
  if not public.has_role('owner', 'head_teacher', 'manager') then
    raise exception 'Only the school can create a group';
  end if;
  select * into pr from public.programs where id = p_program;
  if pr.id is null then raise exception 'No such program'; end if;
  select string_agg(wd[x], '/' order by x) into label from unnest(p_days) as x;
  insert into public.groups (name, level, kind, teacher_id, program_id, days, start_time, tz, start_date, capacity, zoom_url)
  values (coalesce(nullif(trim(p_name), ''), pr.title || ' · ' || label || ' ' || to_char(p_time, 'HH24:MI')),
          pr.level, 'group', p_teacher, p_program, p_days, p_time, p_tz, p_start, p_capacity, p_zoom)
  returning id into gid;
  perform public.schedule_group(gid);
  return gid;
end $$;

-- Carry a group into the next flow: same teacher, days, time, Zoom and
-- people. Whoever does not continue is taken out of the new group by hand.
create function public.continue_group(gid uuid, p_program uuid default null, p_start date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  g public.groups;
  next_prog uuid;
  start_on date;
  new_id uuid;
begin
  if not public.has_role('owner', 'head_teacher', 'manager') then
    raise exception 'Only the school can continue a group';
  end if;
  select * into g from public.groups where id = gid;
  if g.id is null then raise exception 'No such group'; end if;
  next_prog := coalesce(p_program, (select next_program_id from public.programs where id = g.program_id));
  if next_prog is null then raise exception 'Choose the next program'; end if;
  start_on := coalesce(p_start,
    ((select max(starts_at) from public.lessons where group_id = gid) at time zone g.tz)::date + 1,
    current_date);
  new_id := public.create_group(next_prog, g.teacher_id, g.days, g.start_time, start_on,
                                g.capacity, g.zoom_url, null, g.tz);
  update public.groups set continued_from = gid where id = new_id;
  insert into public.group_members (group_id, student_id)
  select new_id, student_id from public.group_members where group_id = gid;
  return new_id;
end $$;

revoke execute on function public.lessons_keep_program() from public, authenticated, anon;
revoke execute on function public.schedule_group(uuid) from public, anon;
revoke execute on function public.create_group(uuid, uuid, int[], time, date, int, text, text, text) from public, anon;
revoke execute on function public.continue_group(uuid, uuid, date) from public, anon;
grant execute on function public.schedule_group(uuid) to authenticated;
grant execute on function public.create_group(uuid, uuid, int[], time, date, int, text, text, text) to authenticated;
grant execute on function public.continue_group(uuid, uuid, date) to authenticated;

-- Progress of every group at a glance.
create view public.group_overview with (security_invoker = true) as
select g.id, g.name, g.level, g.kind, g.teacher_id, g.program_id, g.days, g.start_time, g.tz,
       g.capacity, g.zoom_url, g.active, g.continued_from,
       (select count(*) from public.group_members m where m.group_id = g.id)::int as members,
       (select count(*) from public.lessons l where l.group_id = g.id)::int as lessons_total,
       (select count(*) from public.lessons l where l.group_id = g.id and public.is_counted(l.status))::int as lessons_done,
       (select min(l.starts_at) from public.lessons l where l.group_id = g.id) as first_at,
       (select min(l.starts_at) from public.lessons l
         where l.group_id = g.id and l.status = 'scheduled' and l.starts_at > now() - interval '3 hours') as next_at
  from public.groups g;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.programs enable row level security;
alter table public.program_lessons enable row level security;
alter table public.program_files enable row level security;
alter table public.program_lesson_files enable row level security;
alter table public.lesson_absences enable row level security;

-- A teacher who covers a group lesson sees that group and its people.
create or replace function public.teaches_student(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s where s.id = sid and s.teacher_id = auth.uid())
      or exists (select 1 from public.group_members gm
                   join public.groups g on g.id = gm.group_id
                  where gm.student_id = sid and g.teacher_id = auth.uid())
      or exists (select 1 from public.lessons l where l.student_id = sid and l.teacher_id = auth.uid())
      or exists (select 1 from public.group_members gm
                   join public.lessons l on l.group_id = gm.group_id
                  where gm.student_id = sid and l.teacher_id = auth.uid())
$$;

-- Security definer, so the group rules can look at lessons without the
-- lessons rules looking back at groups (that would loop).
create function public.teaches_group(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = gid and g.teacher_id = auth.uid())
      or exists (select 1 from public.lessons l where l.group_id = gid and l.teacher_id = auth.uid())
$$;
revoke execute on function public.teaches_group(uuid) from public, anon;
grant execute on function public.teaches_group(uuid) to authenticated;

drop policy groups_select on public.groups;
create policy groups_select on public.groups for select using (
  public.has_role('owner', 'head_teacher', 'manager') or public.teaches_group(id)
);
drop policy group_members_select on public.group_members;
create policy group_members_select on public.group_members for select using (
  public.has_role('owner', 'head_teacher', 'manager') or public.teaches_group(group_id)
);

-- Everyone at the school reads programs; the owner and the head teacher write them.
create policy programs_select on public.programs for select
  using (public.has_role('owner', 'head_teacher', 'manager', 'teacher'));
create policy programs_write on public.programs for all
  using (public.has_role('owner', 'head_teacher')) with check (public.has_role('owner', 'head_teacher'));

create policy program_lessons_select on public.program_lessons for select
  using (public.has_role('owner', 'head_teacher', 'manager', 'teacher'));
create policy program_lessons_write on public.program_lessons for all
  using (public.has_role('owner', 'head_teacher')) with check (public.has_role('owner', 'head_teacher'));

create policy program_files_select on public.program_files for select
  using (public.has_role('owner', 'head_teacher', 'manager', 'teacher'));
create policy program_files_write on public.program_files for all
  using (public.has_role('owner', 'head_teacher')) with check (public.has_role('owner', 'head_teacher'));

create policy program_lesson_files_select on public.program_lesson_files for select
  using (public.has_role('owner', 'head_teacher', 'manager', 'teacher'));
create policy program_lesson_files_write on public.program_lesson_files for all
  using (public.has_role('owner', 'head_teacher')) with check (public.has_role('owner', 'head_teacher'));

-- Absences: the teacher of the lesson and the school.
create policy lesson_absences_select on public.lesson_absences for select using (
  public.has_role('owner', 'head_teacher', 'manager')
  or exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid())
);
create policy lesson_absences_write on public.lesson_absences for all
  using (public.has_role('owner', 'head_teacher')
         or exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid()))
  with check (public.has_role('owner', 'head_teacher')
              or exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = auth.uid()));

grant select, insert, update, delete on public.programs, public.program_lessons, public.program_files,
  public.program_lesson_files, public.lesson_absences to authenticated;
grant select on public.group_overview to authenticated;
revoke all on public.programs, public.program_lessons, public.program_files,
  public.program_lesson_files, public.lesson_absences, public.group_overview from anon;
