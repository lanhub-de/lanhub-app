-- The managers' cabinet: payments in two parts, the reason a student stops,
-- and the managers' own marks on their to-do list ("I wrote to her").

-- A package paid in parts: how many of its lessons are paid so far.
-- Empty means paid in full. The rest is recorded when the student pays.
alter table public.packages add column paid_lessons int
  check (paid_lessons is null or paid_lessons > 0);
grant update (paid_lessons) on public.packages to authenticated;

-- Why a student stopped (after a package, or did not buy after a diagnostic).
alter table public.students
  add column left_reason text,
  add column left_note text,
  add column left_at timestamptz;

-- A manager's mark on a task: done for good (remind_at empty) or "show it
-- again on this day if nothing has changed" (wrote to her, she is thinking).
-- ref is what the task is about: the package, the diagnostic lesson or the student.
create table public.manager_marks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('last', 'feedback', 'payment', 'renewal', 'diagnostic', 'nopackage')),
  ref uuid not null,
  student_id uuid not null references public.students (id) on delete cascade,
  remind_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);
alter table public.manager_marks enable row level security;
create policy manager_marks_select on public.manager_marks for select
  using (public.has_role('owner', 'head_teacher', 'manager'));
create policy manager_marks_write on public.manager_marks for all
  using (public.has_role('owner', 'manager'))
  with check (public.has_role('owner', 'manager'));
grant select, insert, update, delete on public.manager_marks to authenticated;

-- Managers delete a card made by mistake: only one without any lessons.
drop policy students_delete on public.students;
create policy students_delete on public.students for delete using (
  public.has_role('owner')
  or (public.has_role('manager')
      and not exists (select 1 from public.lessons l where l.student_id = students.id))
);

-- The package list shows how many lessons are paid.
create or replace view public.package_usage with (security_invoker = true) as
with used as (
  select p.*, (select coalesce(sum(public.lesson_units(l.duration_min)), 0) from public.lessons l
                where l.package_id = p.id and public.is_counted(l.status)) as lessons_used
    from public.packages p
)
select u.id as package_id, u.student_id, u.lessons_total, trim_scale(u.lessons_used) as lessons_used,
       trim_scale(u.lessons_total - u.lessons_used) as lessons_left,
       u.first_lesson_at,
       u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) as valid_until,
       case
         when u.status = 'active'
          and u.first_lesson_at + make_interval(months => u.validity_months, days => u.extra_days) < now()
           then 'expired'
         else u.status
       end as status,
       u.paid_lessons,
       u.created_at
  from used u;
