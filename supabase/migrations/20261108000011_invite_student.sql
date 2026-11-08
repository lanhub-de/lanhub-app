-- Inviting students: the school, the head teacher or the student's own
-- teacher puts her email on the card (that is how she signs in, see
-- link_student) and LanHub emails her an invitation. invited_at shows that
-- the email went out; profile_id shows that she has signed in.
alter table public.students add column invited_at timestamptz;

create or replace function public.set_student_email(sid uuid, p_email text, p_locale text)
returns table (full_name text, teacher_name text, email text, locale text)
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
begin
  if not (public.has_role('owner', 'head_teacher', 'manager') or public.teaches_student(sid)) then
    raise exception 'You do not teach this student';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Check the email address';
  end if;
  update public.students s
     set email = e,
         locale = case when p_locale in ('uk', 'en') then p_locale::public.app_locale else s.locale end
   where s.id = sid;
  return query
    select s.full_name,
           coalesce(p.full_name, i.full_name,
             (select coalesce(gi.full_name, gp.full_name) from public.group_members gm
                join public.groups g on g.id = gm.group_id
                left join public.profiles gp on gp.id = g.teacher_id
                left join public.invites gi on gi.email = g.pending_teacher
               where gm.student_id = s.id order by g.created_at limit 1)),
           s.email, s.locale::text
      from public.students s
      left join public.profiles p on p.id = s.teacher_id
      left join public.invites i on i.email = s.pending_teacher
     where s.id = sid;
end $$;

-- After the invitation email went out.
create function public.student_invite_sent(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role('owner', 'head_teacher', 'manager') or public.teaches_student(sid)) then
    raise exception 'You do not teach this student';
  end if;
  update public.students set invited_at = now() where id = sid;
end $$;

revoke execute on function public.set_student_email(uuid, text, text), public.student_invite_sent(uuid) from public, anon;
grant execute on function public.set_student_email(uuid, text, text), public.student_invite_sent(uuid) to authenticated;

-- The student's real name (first and last) instead of an Instagram nickname.
-- The nickname stays in contact ("Instagram @…"). If she has already signed
-- in, her profile gets the new name too.
create or replace function public.set_student_name(sid uuid, p_first text, p_last text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n text := trim(regexp_replace(concat_ws(' ', nullif(trim(p_first), ''), nullif(trim(p_last), '')), '\s+', ' ', 'g'));
  pid uuid;
begin
  if not (public.has_role('owner', 'head_teacher', 'manager') or public.teaches_student(sid)) then
    raise exception 'You do not teach this student';
  end if;
  if n = '' then return; end if;
  if char_length(n) > 120 then raise exception 'The name is too long'; end if;
  update public.students set full_name = n where id = sid returning profile_id into pid;
  if pid is not null then
    update public.profiles set full_name = n where id = pid;
  end if;
end $$;

revoke execute on function public.set_student_name(uuid, text, text) from public, anon;
grant execute on function public.set_student_name(uuid, text, text) to authenticated;
