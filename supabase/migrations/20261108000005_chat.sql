-- Chat inside LanHub, instead of WhatsApp:
--   group   one chat per group: its teacher and its students
--   direct  a teacher and one student
--   school  a student and the school (owner, managers): payments, timetable
-- The owner and the head teacher can open every group and direct chat to keep
-- an eye on quality; the chat says so to its members.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group', 'direct', 'school')),
  group_id uuid references public.groups (id) on delete cascade,
  teacher_id uuid references public.profiles (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'group' and group_id is not null and teacher_id is null and student_id is null)
      or (kind = 'direct' and group_id is null and teacher_id is not null and student_id is not null)
      or (kind = 'school' and group_id is null and teacher_id is null and student_id is not null))
);
create unique index conversations_one_group on public.conversations (group_id) where kind = 'group';
create unique index conversations_one_direct on public.conversations (teacher_id, student_id) where kind = 'direct';
create unique index conversations_one_school on public.conversations (student_id) where kind = 'school';

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 4000),
  file_path text,
  file_kind text check (file_kind in ('image', 'audio', 'file')),
  file_name text,
  created_at timestamptz not null default now(),
  check (nullif(trim(coalesce(body, '')), '') is not null or file_path is not null)
);
create index messages_by_conversation on public.messages (conversation_id, created_at desc);

create table public.chat_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

-- Phones and computers that asked for notifications.
create table public.push_subscriptions (
  endpoint text primary key,
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- When someone was last emailed about a chat (at most one email per chat
-- every few hours, and only to people without notifications switched on).
create table public.chat_emails (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

-- Server-only settings (not reachable through the API).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);

-- ---------------------------------------------------------------------------
-- Who is in a chat
-- ---------------------------------------------------------------------------
create function public.my_student_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.students where profile_id = auth.uid()
$$;

-- Members: write and get notified. The owner and head teacher can also read
-- group and direct chats (can_chat), without being members.
create function public.chat_members(cid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select g.teacher_id from public.conversations c join public.groups g on g.id = c.group_id
   where c.id = cid and c.kind = 'group' and g.pending_teacher is null
  union
  select s.profile_id from public.conversations c
    join public.group_members m on m.group_id = c.group_id
    join public.students s on s.id = m.student_id
   where c.id = cid and c.kind = 'group' and s.profile_id is not null
  union
  select c.teacher_id from public.conversations c where c.id = cid and c.kind = 'direct'
  union
  select s.profile_id from public.conversations c join public.students s on s.id = c.student_id
   where c.id = cid and c.kind in ('direct', 'school') and s.profile_id is not null
  union
  select p.id from public.conversations c, public.profiles p
   where c.id = cid and c.kind = 'school' and p.active and p.role in ('owner', 'manager')
$$;

create function public.can_chat(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members(cid) m where m = auth.uid())
      or exists (select 1 from public.conversations c
                  where c.id = cid and c.kind in ('group', 'direct')
                    and public.has_role('owner', 'head_teacher'))
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.chat_emails enable row level security;

create policy conversations_select on public.conversations for select using (public.can_chat(id));

create policy messages_select on public.messages for select using (public.can_chat(conversation_id));
create policy messages_insert on public.messages for insert
  with check (sender_id = auth.uid() and public.can_chat(conversation_id));
create policy messages_delete_own on public.messages for delete
  using (sender_id = auth.uid() and created_at > now() - interval '1 hour');

create policy chat_reads_own on public.chat_reads for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy push_own on public.push_subscriptions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant select on public.conversations to authenticated;
revoke insert, update, delete on public.conversations from authenticated;
grant select, insert, delete on public.messages to authenticated;
revoke update on public.messages from authenticated;
grant select, insert, update, delete on public.chat_reads, public.push_subscriptions to authenticated;
revoke all on public.chat_emails from authenticated;
revoke all on public.conversations, public.messages, public.chat_reads, public.push_subscriptions,
  public.chat_emails from anon;

-- A new message moves the chat up and counts as read by its sender.
create function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  insert into public.chat_reads (conversation_id, profile_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, profile_id) do update set last_read_at = excluded.last_read_at;
  return null;
end $$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------------
-- Opening chats
-- ---------------------------------------------------------------------------
-- Finds or makes a chat, if the caller may be in it.
create function public.start_chat(p_kind text, p_group uuid default null,
                                  p_student uuid default null, p_teacher uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cid uuid;
  allowed boolean := false;
begin
  if p_kind = 'group' then
    allowed := public.has_role('owner', 'head_teacher')
      or exists (select 1 from public.groups g where g.id = p_group and g.teacher_id = me and g.pending_teacher is null)
      or exists (select 1 from public.group_members m where m.group_id = p_group
                   and m.student_id in (select public.my_student_ids()));
    if allowed then
      insert into public.conversations (kind, group_id) values ('group', p_group)
      on conflict (group_id) where kind = 'group' do nothing;
      select id into cid from public.conversations where kind = 'group' and group_id = p_group;
    end if;
  elsif p_kind = 'direct' then
    -- the teacher teaches the student: on her card, in her group, or had lessons with her
    allowed := exists (select 1 from public.students s where s.id = p_student and s.teacher_id = p_teacher)
      or exists (select 1 from public.group_members m join public.groups g on g.id = m.group_id
                  where m.student_id = p_student and g.teacher_id = p_teacher and g.pending_teacher is null and g.active)
      or exists (select 1 from public.lessons l where l.student_id = p_student and l.teacher_id = p_teacher
                   and l.pending_teacher is null);
    allowed := allowed and (me = p_teacher
                            or p_student in (select public.my_student_ids())
                            or public.has_role('owner', 'head_teacher'));
    if allowed then
      insert into public.conversations (kind, teacher_id, student_id) values ('direct', p_teacher, p_student)
      on conflict (teacher_id, student_id) where kind = 'direct' do nothing;
      select id into cid from public.conversations where kind = 'direct' and teacher_id = p_teacher and student_id = p_student;
    end if;
  elsif p_kind = 'school' then
    allowed := p_student in (select public.my_student_ids()) or public.has_role('owner', 'manager');
    if allowed then
      insert into public.conversations (kind, student_id) values ('school', p_student)
      on conflict (student_id) where kind = 'school' do nothing;
      select id into cid from public.conversations where kind = 'school' and student_id = p_student;
    end if;
  end if;
  if cid is null then raise exception 'You cannot open this chat'; end if;
  return cid;
end $$;

-- Opens the chats a person always has: a student's group chats, a chat with
-- each of her teachers and with the school; a teacher's group chats and a
-- chat with each student on her card.
create function public.ensure_my_chats() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r record;
begin
  for r in select distinct m.group_id from public.group_members m join public.groups g on g.id = m.group_id
            where m.student_id in (select public.my_student_ids()) and g.active
           union
           select g.id from public.groups g where g.teacher_id = me and g.pending_teacher is null and g.active loop
    insert into public.conversations (kind, group_id) values ('group', r.group_id)
    on conflict (group_id) where kind = 'group' do nothing;
  end loop;

  for r in select s.teacher_id as t, s.id as s from public.students s
            where s.id in (select public.my_student_ids()) and s.teacher_id is not null
           union
           select g.teacher_id, m.student_id from public.group_members m join public.groups g on g.id = m.group_id
            where m.student_id in (select public.my_student_ids()) and g.active and g.pending_teacher is null
           union
           select me, s.id from public.students s where s.teacher_id = me and s.status = 'active' loop
    insert into public.conversations (kind, teacher_id, student_id) values ('direct', r.t, r.s)
    on conflict (teacher_id, student_id) where kind = 'direct' do nothing;
  end loop;

  for r in select id from public.students where id in (select public.my_student_ids()) loop
    insert into public.conversations (kind, student_id) values ('school', r.id)
    on conflict (student_id) where kind = 'school' do nothing;
  end loop;
end $$;

-- The chat list as the caller sees it. "mine" is false for chats the owner or
-- head teacher only looks into.
create function public.my_chats()
returns table (id uuid, kind text, title text, subtitle text, group_id uuid, student_id uuid,
               teacher_id uuid, last_message_at timestamptz, last_body text, unread int, mine boolean)
language sql stable security definer set search_path = public as $$
  with mine as (select c.* from public.conversations c where public.can_chat(c.id))
  select c.id, c.kind,
         case c.kind
           when 'group' then g.name
           when 'school' then case when c.student_id in (select public.my_student_ids()) then 'LanHub' else s.full_name end
           else case when c.teacher_id = auth.uid() then s.full_name
                     when c.student_id in (select public.my_student_ids()) then t.full_name
                     else t.full_name || ' · ' || s.full_name end
         end,
         case c.kind
           when 'group' then (select count(*) from public.group_members m where m.group_id = c.group_id)::text
           else null end,
         c.group_id, c.student_id, c.teacher_id, c.last_message_at,
         (select coalesce(nullif(m.body, ''), m.file_name, '') from public.messages m
           where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.created_at > coalesce((select r.last_read_at from public.chat_reads r
                                           where r.conversation_id = c.id and r.profile_id = auth.uid()), '-infinity'))::int,
         exists (select 1 from public.chat_members(c.id) x where x = auth.uid())
    from mine c
    left join public.groups g on g.id = c.group_id
    left join public.students s on s.id = c.student_id
    left join public.profiles t on t.id = c.teacher_id
   order by c.last_message_at desc nulls last, c.created_at
$$;

create function public.my_unread_total() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread), 0)::int from public.my_chats() where mine
$$;

create function public.mark_chat_read(cid uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.chat_reads (conversation_id, profile_id, last_read_at)
  select cid, auth.uid(), now() where public.can_chat(cid)
  on conflict (conversation_id, profile_id) do update set last_read_at = now()
$$;

-- Names of the people who wrote in a chat, for showing who said what.
create function public.chat_people(cid uuid) returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role from public.profiles p
   where public.can_chat(cid)
     and (p.id in (select public.chat_members(cid))
          or p.id in (select m.sender_id from public.messages m where m.conversation_id = cid))
$$;

-- For the server only: who to notify about a new message and how. Push to
-- every phone or computer of every member but the sender; an email to members
-- without notifications switched on, at most once per chat every 6 hours.
-- Guarded by a secret the app's server holds, so a browser cannot ask for
-- other people's emails.
create function public.chat_notify_targets(mid uuid, secret text)
returns table (profile_id uuid, full_name text, email text, locale public.app_locale,
               endpoint text, p256dh text, auth text, send_email boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  msg public.messages;
begin
  if secret is null or secret is distinct from (select value from private.settings where key = 'chat_secret') then
    raise exception 'Not allowed';
  end if;
  select * into msg from public.messages where id = mid;
  if msg.id is null then return; end if;

  return query
  with members as (
    select m as pid from public.chat_members(msg.conversation_id) m where m <> msg.sender_id
  ), emailed as (
    select p.id from public.profiles p join members on members.pid = p.id
     where not exists (select 1 from public.push_subscriptions ps where ps.profile_id = p.id)
       and not exists (select 1 from public.chat_emails e
                        where e.conversation_id = msg.conversation_id and e.profile_id = p.id
                          and e.sent_at > now() - interval '6 hours')
  ), logged as (
    insert into public.chat_emails (conversation_id, profile_id, sent_at)
    select msg.conversation_id, id, now() from emailed
    on conflict (conversation_id, profile_id) do update set sent_at = now()
    returning chat_emails.profile_id
  )
  select p.id, p.full_name, p.email, p.locale, ps.endpoint, ps.p256dh, ps.auth,
         p.id in (select logged.profile_id from logged)
    from public.profiles p
    join members on members.pid = p.id
    left join public.push_subscriptions ps on ps.profile_id = p.id
   where p.active;
end $$;

revoke execute on function public.chat_notify_targets(uuid, text) from public, authenticated;
grant execute on function public.chat_notify_targets(uuid, text) to anon, authenticated;

-- A phone or computer that stopped accepting notifications is forgotten.
create function public.drop_push_subscription(p_endpoint text, secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if secret is null or secret is distinct from (select value from private.settings where key = 'chat_secret') then
    raise exception 'Not allowed';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

revoke execute on function public.drop_push_subscription(text, text) from public;
grant execute on function public.drop_push_subscription(text, text) to anon, authenticated;

revoke execute on function public.messages_after_insert() from public, anon, authenticated;
revoke execute on function public.my_student_ids(), public.chat_members(uuid), public.can_chat(uuid),
  public.start_chat(text, uuid, uuid, uuid), public.ensure_my_chats(), public.my_chats(),
  public.my_unread_total(), public.mark_chat_read(uuid), public.chat_people(uuid) from public, anon;
grant execute on function public.my_student_ids(), public.chat_members(uuid), public.can_chat(uuid),
  public.start_chat(text, uuid, uuid, uuid), public.ensure_my_chats(), public.my_chats(),
  public.my_unread_total(), public.mark_chat_read(uuid), public.chat_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Files in chats: chat/<conversation id>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 26214400)  -- 25 MB per file
on conflict (id) do nothing;

create policy chat_files_read on storage.objects for select to authenticated
using (bucket_id = 'chat' and public.can_chat(((storage.foldername(name))[1])::uuid));
create policy chat_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'chat' and public.can_chat(((storage.foldername(name))[1])::uuid));

-- New messages reach open chats at once.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
