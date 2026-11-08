-- The head teacher sees every teacher's cabinet (lessons, recordings,
-- materials), including teachers who were invited and have not signed in yet.
-- Pay stays with the owner and the teacher herself (unchanged).
create function public.pending_teacher_list()
returns table (email text, full_name text)
language sql stable security definer set search_path = public as $$
  select i.email, i.full_name
    from public.invites i
   where i.accepted_at is null
     and i.role in ('teacher', 'head_teacher')
     and public.has_role('owner', 'head_teacher')
   order by i.full_name
$$;

revoke execute on function public.pending_teacher_list() from public, anon;
grant execute on function public.pending_teacher_list() to authenticated;
