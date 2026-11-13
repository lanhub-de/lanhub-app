-- Links in the library (Quizlet sets, Canva, Miro …) next to the files: a
-- title, the address, a folder and a level. The whole team sees them; the
-- owner and the head teacher add and tidy them.

create table public.library_links (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 300),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  folder_id uuid references public.library_folders (id) on delete restrict,
  level text check (char_length(level) <= 20),
  staff_only boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index library_links_folder on public.library_links (folder_id);
create unique index library_links_unique on public.library_links (coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), url);

alter table public.library_links enable row level security;
create policy library_links_select on public.library_links for select
  using (public.has_role('owner', 'head_teacher', 'manager', 'teacher'));
create policy library_links_insert on public.library_links for insert
  with check (public.has_role('owner', 'head_teacher'));
create policy library_links_update on public.library_links for update
  using (public.has_role('owner', 'head_teacher')) with check (public.has_role('owner', 'head_teacher'));
create policy library_links_delete on public.library_links for delete
  using (public.has_role('owner', 'head_teacher'));
revoke all on public.library_links from anon;
grant select, insert, update, delete on public.library_links to authenticated;
