-- Zoom for individual lessons, the student's working links and the teacher's
-- notes about her, the lesson's topic and homework task, and a student's view
-- the school and her teacher can open.

-- A teacher's own Zoom room, used when a lesson and the student have none.
alter table public.teacher_settings add column zoom_url text;

-- On the student's card: her regular Zoom link, her GoodNotes and Quizlet,
-- and when she usually has lessons. She sees these herself.
alter table public.students
  add column zoom_url text,
  add column goodnotes_url text,
  add column quizlet_url text,
  add column schedule_note text;

-- What the teacher knows about the student (goals, strengths, what to work
-- on). For teachers and the school only, never for the student.
create table public.student_notes (
  student_id uuid primary key references public.students (id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 8000),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.student_notes enable row level security;
create policy student_notes_read on public.student_notes for select using (
  public.has_role('owner', 'head_teacher', 'manager') or public.teaches_student(student_id)
);
grant select on public.student_notes to authenticated;
revoke insert, update, delete on public.student_notes from authenticated;
revoke all on public.student_notes from anon;

-- The teacher (or the school) saves the working links and notes.
create function public.save_student_info(sid uuid, p_zoom text, p_goodnotes text, p_quizlet text,
                                         p_schedule text, p_notes text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role('owner', 'head_teacher', 'manager') or public.teaches_student(sid)) then
    raise exception 'You do not teach this student';
  end if;
  update public.students
     set zoom_url = nullif(trim(p_zoom), ''), goodnotes_url = nullif(trim(p_goodnotes), ''),
         quizlet_url = nullif(trim(p_quizlet), ''), schedule_note = nullif(trim(p_schedule), '')
   where id = sid;
  insert into public.student_notes (student_id, notes, updated_by, updated_at)
  values (sid, coalesce(p_notes, ''), auth.uid(), now())
  on conflict (student_id) do update set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
end $$;

revoke execute on function public.save_student_info(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.save_student_info(uuid, text, text, text, text, text) to authenticated;

-- The lesson's homework task (what to do), next to its topic (note).
alter table public.lessons add column homework_text text check (char_length(homework_text) <= 4000);
grant update (homework_text) on public.lessons to authenticated;

-- The Zoom link a lesson actually uses: its own, else the student's, else
-- the teacher's room.
create function public.lesson_zoom(lid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(l.zoom_url, s.zoom_url, ts.zoom_url, g.zoom_url)
    from public.lessons l
    left join public.students s on s.id = l.student_id
    left join public.groups g on g.id = l.group_id
    left join public.teacher_settings ts on ts.teacher_id = l.teacher_id and l.pending_teacher is null
   where l.id = lid
$$;

-- A student's individual lessons for her own home, or for the school and her
-- teacher looking at it as she sees it.
create function public.student_lessons(sid uuid, p_from timestamptz, p_to timestamptz)
returns table (id uuid, starts_at timestamptz, duration_min int, status public.lesson_status,
               zoom_url text, recording_url text, homework_url text, note text, homework_text text,
               teacher_id uuid, teacher_name text, student_id uuid)
language sql stable security definer set search_path = public as $$
  select l.id, l.starts_at, l.duration_min, l.status, public.lesson_zoom(l.id), l.recording_url, l.homework_url,
         l.note, l.homework_text,
         l.teacher_id, case when l.pending_teacher is null then p.full_name else i.full_name end, l.student_id
    from public.lessons l
    left join public.profiles p on p.id = l.teacher_id
    left join public.invites i on i.email = l.pending_teacher
   where l.student_id = sid
     and (sid in (select public.my_student_ids())
          or public.has_role('owner', 'head_teacher', 'manager')
          or public.teaches_student(sid))
     and l.starts_at >= p_from and l.starts_at < p_to
   order by l.starts_at
$$;

-- The student's teacher for her home: name, and whether the chat is open
-- (an invited teacher who has not signed in yet cannot chat).
create function public.student_teacher(sid uuid)
returns table (teacher_id uuid, teacher_name text, can_chat boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(s.teacher_id, null), coalesce(p.full_name, i.full_name), s.teacher_id is not null
    from public.students s
    left join public.profiles p on p.id = s.teacher_id
    left join public.invites i on i.email = s.pending_teacher
   where s.id = sid
     and (sid in (select public.my_student_ids())
          or public.has_role('owner', 'head_teacher', 'manager')
          or public.teaches_student(sid))
$$;

revoke execute on function public.lesson_zoom(uuid), public.student_lessons(uuid, timestamptz, timestamptz),
  public.student_teacher(uuid) from public, anon;
grant execute on function public.lesson_zoom(uuid), public.student_lessons(uuid, timestamptz, timestamptz),
  public.student_teacher(uuid) to authenticated;
