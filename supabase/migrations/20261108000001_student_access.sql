-- Students see their own group's course page: timetable, Zoom, the program
-- lessons (never the teacher notes) and the course files meant for them.
-- A student signs in with the email on their student card; no invite needed.
-- Everything a student reads goes through the functions below, so the raw
-- lesson rows (teacher notes, packages, pay) stay out of their reach.

-- ---------------------------------------------------------------------------
-- Sign-in
-- ---------------------------------------------------------------------------
create function public.link_student(uid uuid, user_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  card public.students;
  existing public.app_role;
begin
  if user_email is null then return; end if;
  select role into existing from public.profiles where id = uid;
  if existing is not null and existing <> 'student' then return; end if;
  if exists (select 1 from public.students where profile_id = uid) then return; end if;
  select * into card from public.students
   where lower(email) = lower(user_email) and profile_id is null and status <> 'left'
   order by created_at limit 1;
  if card.id is null then return; end if;
  if existing is null then
    insert into public.profiles (id, full_name, email, role, locale)
    values (uid, card.full_name, lower(user_email), 'student', card.locale);
  end if;
  update public.students set profile_id = uid where id = card.id;
end $$;

create or replace function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    perform public.accept_invite(new.id, new.email);
    perform public.link_student(new.id, new.email);
  end if;
  return new;
end
$$;

-- An email added to a card of someone who already signed in links at once.
create function public.students_link_login() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if new.email is not null and new.profile_id is null then
    select id into uid from auth.users where lower(email) = lower(new.email);
    if uid is not null then
      perform public.link_student(uid, new.email);
    end if;
  end if;
  return null;
end $$;
create trigger students_link_login after insert or update of email on public.students
  for each row execute function public.students_link_login();

-- ---------------------------------------------------------------------------
-- Who may see a group's course page
-- ---------------------------------------------------------------------------
create function public.in_my_groups(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members gm
                   join public.students s on s.id = gm.student_id
                  where gm.group_id = gid and s.profile_id = auth.uid())
$$;

create function public.can_see_course(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner', 'head_teacher', 'manager')
      or public.teaches_group(gid)
      or public.in_my_groups(gid)
$$;

-- The groups a signed-in student belongs to.
create function public.my_course_groups()
returns table (id uuid, name text, program_title text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, p.title
    from public.groups g
    left join public.programs p on p.id = g.program_id
   where g.active and public.in_my_groups(g.id)
   order by g.created_at desc
$$;

-- The header of a course page.
create function public.course_group(gid uuid)
returns table (id uuid, name text, level text, days int[], start_time time, tz text, zoom_url text,
               program_id uuid, program_title text, program_level text, teacher_name text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.level, g.days, g.start_time, g.tz, g.zoom_url,
         g.program_id, p.title, p.level, pr.full_name
    from public.groups g
    left join public.programs p on p.id = g.program_id
    left join public.profiles pr on pr.id = g.teacher_id
   where g.id = gid and public.can_see_course(gid)
$$;

-- The group's lessons, with only what a student needs.
create function public.course_schedule(gid uuid)
returns table (id uuid, starts_at timestamptz, duration_min int, status public.lesson_status,
               zoom_url text, recording_url text, homework_url text, program_lesson_id uuid)
language sql stable security definer set search_path = public as $$
  select l.id, l.starts_at, l.duration_min, l.status, l.zoom_url, l.recording_url, l.homework_url, l.program_lesson_id
    from public.lessons l
   where l.group_id = gid and public.can_see_course(gid)
   order by l.starts_at
$$;

-- The program lessons of a group, without the teacher notes.
create function public.course_lessons(gid uuid)
returns table (id uuid, n int, title text, topic text, goal text, rule text, prepare text, after_note text,
               connected text, homework_url text, vocab_url text, slides_url text)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.n, pl.title, pl.topic, pl.goal, pl.rule, pl.prepare, pl.after_note, pl.connected,
         pl.homework_url, pl.vocab_url, pl.slides_url
    from public.program_lessons pl
    join public.groups g on g.program_id = pl.program_id
   where g.id = gid and public.can_see_course(gid)
   order by pl.n
$$;

-- Course guides and lesson files that are meant for students.
create function public.course_files(gid uuid)
returns table (file_id uuid, title text, program_lesson_id uuid)
language sql stable security definer set search_path = public as $$
  select f.id, f.title, null::uuid
    from public.groups g
    join public.program_files pf on pf.program_id = g.program_id and pf.for_students
    join public.files f on f.id = pf.file_id
   where g.id = gid and public.can_see_course(gid)
  union all
  select f.id, f.title, plf.program_lesson_id
    from public.groups g
    join public.program_lessons pl on pl.program_id = g.program_id
    join public.program_lesson_files plf on plf.program_lesson_id = pl.id and plf.for_students
    join public.files f on f.id = plf.file_id
   where g.id = gid and public.can_see_course(gid)
$$;

-- A student may open a course file of one of their groups.
create function public.course_file_for_me(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
      join public.program_files pf on pf.program_id = g.program_id and pf.for_students
     where pf.file_id = fid and g.active and public.in_my_groups(g.id))
  or exists (
    select 1 from public.groups g
      join public.program_lessons pl on pl.program_id = g.program_id
      join public.program_lesson_files plf on plf.program_lesson_id = pl.id and plf.for_students
     where plf.file_id = fid and g.active and public.in_my_groups(g.id))
$$;

drop policy files_select on public.files;
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
  or public.course_file_for_me(id)
);

revoke execute on function public.link_student(uuid, text) from public, anon, authenticated;
revoke execute on function public.students_link_login() from public, anon, authenticated;
revoke execute on function public.in_my_groups(uuid) from public, anon;
revoke execute on function public.can_see_course(uuid) from public, anon;
revoke execute on function public.my_course_groups() from public, anon;
revoke execute on function public.course_group(uuid) from public, anon;
revoke execute on function public.course_schedule(uuid) from public, anon;
revoke execute on function public.course_lessons(uuid) from public, anon;
revoke execute on function public.course_files(uuid) from public, anon;
revoke execute on function public.course_file_for_me(uuid) from public, anon;
grant execute on function public.in_my_groups(uuid), public.can_see_course(uuid), public.my_course_groups(),
  public.course_group(uuid), public.course_schedule(uuid), public.course_lessons(uuid), public.course_files(uuid),
  public.course_file_for_me(uuid) to authenticated;
