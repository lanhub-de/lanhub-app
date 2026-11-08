-- Groups, students and lessons can be set up for a teacher who has been
-- invited but has not signed in yet. Until then they wait under the person
-- who set them up, marked with the invite's email, and no pay is written.
-- On the teacher's first sign-in everything moves to her and the pay of the
-- lessons already held is worked out from her rates.

alter table public.groups add column pending_teacher text references public.invites (email) on delete set null;
alter table public.students add column pending_teacher text references public.invites (email) on delete set null;
alter table public.lessons add column pending_teacher text references public.invites (email) on delete set null;

-- The invited person's name, for the school's screens.
create function public.pending_name(e text) returns text
language sql stable security definer set search_path = public as $$
  select i.full_name from public.invites i
   where i.email = e and public.has_role('owner', 'head_teacher', 'manager')
$$;

revoke execute on function public.pending_name(text) from public, anon;
grant execute on function public.pending_name(text) to authenticated;

create or replace view public.group_overview with (security_invoker = true) as
select g.id, g.name, g.level, g.kind, g.teacher_id, g.program_id, g.days, g.start_time, g.tz,
       g.capacity, g.zoom_url, g.active, g.continued_from,
       (select count(*) from public.group_members m where m.group_id = g.id)::int as members,
       (select count(*) from public.lessons l where l.group_id = g.id)::int as lessons_total,
       (select count(*) from public.lessons l where l.group_id = g.id and public.is_counted(l.status))::int as lessons_done,
       (select min(l.starts_at) from public.lessons l where l.group_id = g.id) as first_at,
       (select min(l.starts_at) from public.lessons l
         where l.group_id = g.id and l.status = 'scheduled' and l.starts_at > now() - interval '3 hours') as next_at,
       g.pending_teacher,
       public.pending_name(g.pending_teacher) as pending_teacher_name
  from public.groups g;

-- Students see the invited teacher's name on their course page too.
create or replace function public.course_group(gid uuid)
returns table (id uuid, name text, level text, days int[], start_time time, tz text, zoom_url text,
               program_id uuid, program_title text, program_level text, teacher_name text)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.level, g.days, g.start_time, g.tz, g.zoom_url,
         g.program_id, p.title, p.level,
         case when g.pending_teacher is not null
              then (select i.full_name from public.invites i where i.email = g.pending_teacher)
              else pr.full_name end
    from public.groups g
    left join public.programs p on p.id = g.program_id
    left join public.profiles pr on pr.id = g.teacher_id
   where g.id = gid and public.can_see_course(gid)
$$;

-- No pay while the lesson waits for its teacher.
create or replace function public.write_lesson_pay(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.lessons;
  rid uuid;
  rate numeric;
  step numeric;
  rate_currency text;
  stu_market text;
  pkg_size int;
  present int;
begin
  select * into l from public.lessons where id = lid;
  if l.id is null then return; end if;

  if not public.is_counted(l.status) or l.pending_teacher is not null then
    delete from public.lesson_pay where lesson_id = l.id;
    return;
  end if;

  select market into stu_market from public.students where id = l.student_id;
  select lessons_total into pkg_size from public.packages where id = l.package_id;
  present := public.lesson_present(l.id);

  select tr.id, tr.amount, tr.currency into rid, rate, rate_currency
    from public.teacher_rates tr
   where tr.teacher_id = l.teacher_id
     and tr.kind = l.kind
     and tr.valid_from <= l.starts_at::date
     and (tr.band is null or tr.band = l.band)
     and (tr.market is null or tr.market = stu_market)
     and (tr.package_lessons is null or tr.package_lessons = pkg_size)
     and (tr.student_id is null or tr.student_id = l.student_id)
     and (tr.group_id is null or tr.group_id = l.group_id)
   order by (tr.student_id is not null or tr.group_id is not null) desc,
            (tr.market is not null) desc,
            (tr.package_lessons is not null) desc,
            (tr.band is not null) desc,
            tr.valid_from desc
   limit 1;

  if rid is not null and present is not null then
    select s.amount into step from public.rate_steps s
     where s.rate_id = rid and s.min_present <= present
     order by s.min_present desc limit 1;
    rate := coalesce(step, rate);
  end if;

  insert into public.lesson_pay (lesson_id, teacher_id, amount, currency, month)
  values (l.id, l.teacher_id, coalesce(rate, 0), coalesce(rate_currency, 'UAH'),
          date_trunc('month', l.starts_at)::date)
  on conflict (lesson_id) do update
    set amount = excluded.amount, currency = excluded.currency,
        month = excluded.month, teacher_id = excluded.teacher_id;
end
$$;

revoke execute on function public.write_lesson_pay(uuid) from public, anon, authenticated;

-- A new group for an invited teacher: scheduled at once, waiting for her.
create function public.create_group_for_invite(
  p_program uuid, p_invite text, p_days int[], p_time time, p_start date,
  p_capacity int default 10, p_zoom text default null, p_name text default null,
  p_tz text default 'Europe/Vienna'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  ready uuid;
  gid uuid;
begin
  if not public.has_role('owner', 'head_teacher', 'manager') then
    raise exception 'Only the school can create a group';
  end if;
  select id into ready from public.profiles where email = lower(p_invite);
  if ready is not null then
    return public.create_group(p_program, ready, p_days, p_time, p_start, p_capacity, p_zoom, p_name, p_tz);
  end if;
  select * into inv from public.invites where email = lower(p_invite) and accepted_at is null;
  if inv.email is null or inv.role not in ('teacher', 'head_teacher', 'owner') then
    raise exception 'No pending invite for a teacher with this email';
  end if;
  gid := public.create_group(p_program, auth.uid(), p_days, p_time, p_start, p_capacity, p_zoom, p_name, p_tz);
  update public.groups set pending_teacher = inv.email where id = gid;
  update public.lessons set pending_teacher = inv.email where group_id = gid;
  return gid;
end $$;

revoke execute on function public.create_group_for_invite(uuid, text, int[], time, date, int, text, text, text) from public, anon;
grant execute on function public.create_group_for_invite(uuid, text, int[], time, date, int, text, text, text) to authenticated;

-- Hand a group to a teacher (p_teacher) or to an invited one (p_invite).
-- Lessons to come, and any still waiting for a teacher, follow the group.
create function public.set_group_teacher(gid uuid, p_teacher uuid, p_invite text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ready uuid;
begin
  if not public.has_role('owner', 'head_teacher', 'manager') then
    raise exception 'Only the school can change the teacher';
  end if;
  if p_invite is not null then
    select id into ready from public.profiles where email = lower(p_invite);
    if ready is not null then
      p_teacher := ready;
      p_invite := null;
    elsif not exists (select 1 from public.invites where email = lower(p_invite) and accepted_at is null) then
      raise exception 'No pending invite with this email';
    else
      p_teacher := auth.uid();
      p_invite := lower(p_invite);
    end if;
  end if;
  if p_teacher is null then raise exception 'Choose a teacher'; end if;
  update public.groups set teacher_id = p_teacher, pending_teacher = p_invite where id = gid;
  update public.lessons set teacher_id = p_teacher, pending_teacher = p_invite
   where group_id = gid and (pending_teacher is not null or (status = 'scheduled' and starts_at > now()));
end $$;

revoke execute on function public.set_group_teacher(uuid, uuid, text) from public, anon;
grant execute on function public.set_group_teacher(uuid, uuid, text) to authenticated;

-- First sign-in: profile, rates, monthly extras, then everything that waited.
create or replace function public.accept_invite(uid uuid, user_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  r jsonb;
  st jsonb;
  rid uuid;
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
    rid := null;
    insert into public.teacher_rates (teacher_id, kind, band, market, package_lessons, amount, valid_from)
    values (uid,
            (r ->> 'kind')::public.lesson_kind,
            (r ->> 'band')::public.level_band,
            r ->> 'market',
            (r ->> 'package_lessons')::int,
            (r ->> 'amount')::numeric,
            coalesce((r ->> 'valid_from')::date, date '2026-09-01'))
    on conflict do nothing
    returning id into rid;
    if rid is not null then
      for st in select * from jsonb_array_elements(coalesce(r -> 'steps', '[]'::jsonb)) loop
        insert into public.rate_steps (rate_id, min_present, amount)
        values (rid, (st ->> 'min_present')::int, (st ->> 'amount')::numeric);
      end loop;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(inv.pending_allowances) loop
    insert into public.teacher_allowances (teacher_id, label, amount, currency, starts_on)
    values (uid, r ->> 'label', (r ->> 'amount')::numeric, coalesce(r ->> 'currency', 'UAH'),
            coalesce((r ->> 'starts_on')::date, date_trunc('month', now())::date));
  end loop;

  update public.students set teacher_id = uid, pending_teacher = null where pending_teacher = inv.email;
  update public.groups set teacher_id = uid, pending_teacher = null where pending_teacher = inv.email;
  -- the lesson trigger writes the pay from the rates added above
  update public.lessons set teacher_id = uid, pending_teacher = null where pending_teacher = inv.email;

  update public.invites set accepted_at = now() where email = inv.email;
end
$$;

revoke execute on function public.accept_invite(uuid, text) from public, anon, authenticated;
