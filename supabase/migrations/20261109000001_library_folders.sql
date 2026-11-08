-- The school library in folders (LanHub textbooks by level, exams, groups).
-- Team-only files (teacher guides) are for the team: students never see them,
-- and they cannot be put on a lesson or a course for students.
alter table public.files
  add column staff_only boolean not null default false,
  add column size_bytes bigint;

alter table public.library_folders
  add column created_by uuid default auth.uid() references public.profiles (id) on delete set null;

-- one name per place, so uploading the same folder twice reuses it
create unique index library_folders_unique_name
  on public.library_folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index files_folder_idx on public.files (folder_id);

-- Students: their lesson files and course files, never team-only ones.
drop policy files_select on public.files;
create policy files_select on public.files for select using (
  (visibility = 'library' and public.has_role('owner', 'head_teacher', 'teacher'))
  or uploaded_by = auth.uid()
  or public.has_role('owner', 'head_teacher')
  or exists (select 1 from public.lesson_files lf
               join public.lessons l on l.id = lf.lesson_id
              where lf.file_id = files.id
                and (l.teacher_id = auth.uid()
                     or (not files.staff_only
                         and exists (select 1 from public.students s
                                      where s.id = l.student_id and s.profile_id = auth.uid()))))
  or (not staff_only and public.course_file_for_me(id))
);

create or replace function public.course_files(gid uuid)
returns table (file_id uuid, title text, program_lesson_id uuid)
language sql stable security definer set search_path = public as $$
  select f.id, f.title, null::uuid
    from public.groups g
    join public.program_files pf on pf.program_id = g.program_id and pf.for_students
    join public.files f on f.id = pf.file_id and not f.staff_only
   where g.id = gid and public.can_see_course(gid)
  union all
  select f.id, f.title, plf.program_lesson_id
    from public.groups g
    join public.program_lessons pl on pl.program_id = g.program_id
    join public.program_lesson_files plf on plf.program_lesson_id = pl.id and plf.for_students
    join public.files f on f.id = plf.file_id and not f.staff_only
   where g.id = gid and public.can_see_course(gid)
$$;

-- A team-only file stays off anything students open.
create function public.no_team_only_for_students() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- lesson files always reach the student; course files when for_students
  if coalesce((to_jsonb(new) ->> 'for_students')::boolean, true)
     and exists (select 1 from public.files where id = new.file_id and staff_only) then
    raise exception 'This file is for the team only (teacher guide), students cannot get it';
  end if;
  return new;
end
$$;
revoke execute on function public.no_team_only_for_students() from public, anon, authenticated;

create trigger lesson_files_team_only before insert or update on public.lesson_files
  for each row execute function public.no_team_only_for_students();
create trigger program_files_team_only before insert or update on public.program_files
  for each row execute function public.no_team_only_for_students();
create trigger program_lesson_files_team_only before insert or update on public.program_lesson_files
  for each row execute function public.no_team_only_for_students();

-- Audio for a textbook: which track plays on which page ("p. 14 · Ex. 3"),
-- so teachers never look up the original book's track numbers. The tracks
-- are audio files in the library; the team sees and plays them.
create table public.file_audio (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files (id) on delete cascade,
  audio_id uuid not null references public.files (id) on delete cascade,
  page int not null check (page > 0),
  label text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index file_audio_file_idx on public.file_audio (file_id, page, position);
alter table public.file_audio enable row level security;
create policy file_audio_select on public.file_audio for select
  using (public.has_role('owner', 'head_teacher', 'teacher'));
create policy file_audio_write on public.file_audio for all
  using (public.has_role('owner', 'head_teacher'))
  with check (public.has_role('owner', 'head_teacher'));
grant select, insert, update, delete on public.file_audio to authenticated;
revoke all on public.file_audio from anon;
