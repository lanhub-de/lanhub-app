-- Homework handed in on the platform: one hand-in per student per lesson
-- (handing in again replaces it), checked by the lesson's teacher with a
-- comment and, if she likes, a corrected file. The owner and the head
-- teacher can see and check too.

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  body text check (char_length(body) <= 8000),
  file_path text,
  file_kind text check (file_kind in ('image', 'audio', 'file')),
  file_name text,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'checked')),
  feedback text check (char_length(feedback) <= 8000),
  feedback_file_path text,
  feedback_file_kind text check (feedback_file_kind in ('image', 'audio', 'file')),
  feedback_file_name text,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  unique (lesson_id, student_id),
  check (nullif(trim(coalesce(body, '')), '') is not null or file_path is not null)
);
create index homework_by_status on public.homework (status, submitted_at);

-- The student is in the lesson: it is her individual lesson or her group's.
create function public.in_lesson(lid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lessons l
     where l.id = lid
       and (l.student_id = sid
            or exists (select 1 from public.group_members m where m.group_id = l.group_id and m.student_id = sid)))
$$;

-- The caller checks this lesson's homework: its teacher, or the owner or head teacher.
create function public.checks_lesson(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('owner', 'head_teacher')
      or exists (select 1 from public.lessons l
                  where l.id = lid and l.teacher_id = auth.uid() and l.pending_teacher is null)
$$;

alter table public.homework enable row level security;

create policy homework_select on public.homework for select using (
  student_id in (select public.my_student_ids()) or public.checks_lesson(lesson_id)
);

grant select on public.homework to authenticated;
revoke insert, update, delete on public.homework from authenticated;
revoke all on public.homework from anon;

-- Hand in (or hand in again) the homework for a lesson.
create function public.submit_homework(p_lesson uuid, p_body text, p_file_path text default null,
                                       p_file_kind text default null, p_file_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  hid uuid;
begin
  select s into sid from public.my_student_ids() s where public.in_lesson(p_lesson, s) limit 1;
  if sid is null then raise exception 'This is not your lesson'; end if;
  insert into public.homework (lesson_id, student_id, body, file_path, file_kind, file_name)
  values (p_lesson, sid, nullif(trim(p_body), ''), p_file_path, case when p_file_path is null then null else p_file_kind end,
          case when p_file_path is null then null else p_file_name end)
  on conflict (lesson_id, student_id) do update
    set body = excluded.body, file_path = excluded.file_path, file_kind = excluded.file_kind,
        file_name = excluded.file_name, submitted_at = now(), status = 'submitted',
        feedback = null, feedback_file_path = null, feedback_file_kind = null, feedback_file_name = null,
        checked_by = null, checked_at = null
  returning id into hid;
  return hid;
end $$;

-- Check a hand-in: a comment and/or a file back to the student.
create function public.review_homework(p_id uuid, p_feedback text, p_file_path text default null,
                                       p_file_kind text default null, p_file_name text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  h public.homework;
begin
  select * into h from public.homework where id = p_id;
  if h.id is null or not public.checks_lesson(h.lesson_id) then
    raise exception 'You cannot check this homework';
  end if;
  update public.homework
     set status = 'checked', feedback = nullif(trim(p_feedback), ''),
         feedback_file_path = p_file_path,
         feedback_file_kind = case when p_file_path is null then null else p_file_kind end,
         feedback_file_name = case when p_file_path is null then null else p_file_name end,
         checked_by = auth.uid(), checked_at = now()
   where id = p_id;
end $$;

revoke execute on function public.in_lesson(uuid, uuid), public.checks_lesson(uuid),
  public.submit_homework(uuid, text, text, text, text), public.review_homework(uuid, text, text, text, text) from public, anon;
grant execute on function public.in_lesson(uuid, uuid), public.checks_lesson(uuid),
  public.submit_homework(uuid, text, text, text, text), public.review_homework(uuid, text, text, text, text) to authenticated;

-- A student's own individual lessons with the teacher's name (students do
-- not see teachers' profiles directly).
create function public.my_lessons(p_from timestamptz, p_to timestamptz)
returns table (id uuid, starts_at timestamptz, duration_min int, status public.lesson_status,
               zoom_url text, recording_url text, homework_url text, teacher_id uuid, teacher_name text, student_id uuid)
language sql stable security definer set search_path = public as $$
  select l.id, l.starts_at, l.duration_min, l.status, l.zoom_url, l.recording_url, l.homework_url,
         l.teacher_id, case when l.pending_teacher is null then p.full_name else i.full_name end, l.student_id
    from public.lessons l
    left join public.profiles p on p.id = l.teacher_id
    left join public.invites i on i.email = l.pending_teacher
   where l.student_id in (select public.my_student_ids())
     and l.starts_at >= p_from and l.starts_at < p_to
   order by l.starts_at
$$;

revoke execute on function public.my_lessons(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_lessons(timestamptz, timestamptz) to authenticated;

-- Files: homework/<lesson id>/<student id>/<file>. The student writes into her
-- own folder; the teacher (and owner, head teacher) reads it and writes the
-- corrected file back into the same folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('homework', 'homework', false, 26214400)
on conflict (id) do nothing;

create policy homework_files_read on storage.objects for select to authenticated
using (
  bucket_id = 'homework'
  and (((storage.foldername(name))[2])::uuid in (select public.my_student_ids())
       or public.checks_lesson(((storage.foldername(name))[1])::uuid))
);
create policy homework_files_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'homework'
  and ((((storage.foldername(name))[2])::uuid in (select public.my_student_ids())
        and public.in_lesson(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid))
       or public.checks_lesson(((storage.foldername(name))[1])::uuid))
);
