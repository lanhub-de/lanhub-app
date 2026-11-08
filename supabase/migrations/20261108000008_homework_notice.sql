-- What a hand-in is about, for the chat message that tells the other side:
-- the lesson's teacher, the student and a short label ("Lesson 3 · Indirekte
-- Fragen" or the date of an individual lesson). For the student who handed it
-- in and for whoever checks it.
create function public.homework_notice(hid uuid)
returns table (teacher_id uuid, student_id uuid, waiting boolean, label text, group_name text)
language sql stable security definer set search_path = public as $$
  select l.teacher_id, h.student_id, l.pending_teacher is not null,
         coalesce('L' || pl.n || ' · ' || pl.title, to_char(l.starts_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI')),
         g.name
    from public.homework h
    join public.lessons l on l.id = h.lesson_id
    left join public.program_lessons pl on pl.id = l.program_lesson_id
    left join public.groups g on g.id = l.group_id
   where h.id = hid
     and (h.student_id in (select public.my_student_ids()) or public.checks_lesson(h.lesson_id))
$$;

revoke execute on function public.homework_notice(uuid) from public, anon;
grant execute on function public.homework_notice(uuid) to authenticated;
