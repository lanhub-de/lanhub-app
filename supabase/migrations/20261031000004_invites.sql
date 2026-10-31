-- Invites: the owner adds a person by email with a role (and, for teachers,
-- their rates). The first time that person signs in with a code sent to the
-- email, their profile is created from the invite. People without an invite
-- can request a code but get no profile, and with no profile every access
-- rule denies them everything.

create table public.invites (
  email text primary key check (email = lower(email)),
  full_name text not null,
  role public.app_role not null,
  locale public.app_locale not null default 'uk',
  pending_rates jsonb not null default '[]'::jsonb,
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

alter table public.invites enable row level security;

-- Owner invites anyone; managers invite students (stage 3).
create policy invites_owner on public.invites for all
  using (public.has_role('owner')) with check (public.has_role('owner'));
create policy invites_manager_students on public.invites for all
  using (public.has_role('manager') and role = 'student')
  with check (public.has_role('manager') and role = 'student');

grant select, insert, update, delete on public.invites to authenticated;
revoke all on public.invites from anon;

-- Turn an invite into a profile (and rates) for an existing auth user.
create function public.accept_invite(uid uuid, user_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  r jsonb;
begin
  select * into inv from public.invites
   where email = lower(user_email) and accepted_at is null;
  if not found or exists (select 1 from public.profiles where id = uid) then
    return;
  end if;

  insert into public.profiles (id, full_name, email, role, locale)
  values (uid, inv.full_name, inv.email, inv.role, inv.locale);

  if inv.role in ('teacher', 'head_teacher', 'owner') then
    insert into public.teacher_settings (teacher_id) values (uid) on conflict do nothing;
  end if;

  for r in select * from jsonb_array_elements(inv.pending_rates) loop
    insert into public.teacher_rates (teacher_id, kind, band, market, package_lessons, amount, valid_from)
    values (uid,
            (r ->> 'kind')::public.lesson_kind,
            (r ->> 'band')::public.level_band,
            r ->> 'market',
            (r ->> 'package_lessons')::int,
            (r ->> 'amount')::numeric,
            coalesce((r ->> 'valid_from')::date, date '2026-09-01'))
    on conflict do nothing;
  end loop;

  update public.invites set accepted_at = now() where email = inv.email;
end
$$;

revoke execute on function public.accept_invite(uuid, text) from public, anon, authenticated;

-- A new sign-in with an invited email gets its profile at once.
create function public.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    perform public.accept_invite(new.id, new.email);
  end if;
  return new;
end
$$;

revoke execute on function public.on_auth_user_created() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- An invite added for someone who already signed in once is accepted at once.
create function public.on_invite_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = new.email;
  if uid is not null then
    perform public.accept_invite(uid, new.email);
  end if;
  return null;
end
$$;

revoke execute on function public.on_invite_created() from public, anon, authenticated;

create trigger on_invite_created
  after insert on public.invites
  for each row execute function public.on_invite_created();
