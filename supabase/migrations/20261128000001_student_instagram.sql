-- A student's Instagram nickname (or another contact, e.g. a phone), so the
-- managers find her in Direct. Kept apart from the students table on purpose:
-- teachers read student cards, and the nickname is for the owner and the
-- managers only.
create table public.student_instagram (
  student_id uuid primary key references public.students (id) on delete cascade,
  handle text not null check (length(handle) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.student_instagram enable row level security;
create policy student_instagram_school on public.student_instagram for all
  using (public.has_role('owner', 'manager'))
  with check (public.has_role('owner', 'manager'));
grant select, insert, update, delete on public.student_instagram to authenticated;
