-- The owner switches people on and off and changes roles. Ordinary users may
-- only change their own name and language, so these go through checked
-- functions instead of a direct table update.

create function public.set_profile_active(target uuid, is_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot switch yourself off' using errcode = 'P0001';
  end if;
  update public.profiles set active = is_active where id = target;
end
$$;

create function public.set_profile_role(target uuid, new_role public.app_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('owner') then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if target = auth.uid() and new_role <> 'owner' then
    raise exception 'You cannot remove your own owner role' using errcode = 'P0001';
  end if;
  update public.profiles set role = new_role where id = target;
  if new_role in ('teacher', 'head_teacher', 'owner') then
    insert into public.teacher_settings (teacher_id) values (target) on conflict do nothing;
  end if;
end
$$;

revoke execute on function public.set_profile_active(uuid, boolean) from public, anon;
revoke execute on function public.set_profile_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_profile_active(uuid, boolean) to authenticated;
grant execute on function public.set_profile_role(uuid, public.app_role) to authenticated;
