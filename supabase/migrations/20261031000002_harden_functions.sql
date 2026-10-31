-- Security advisor fixes.
-- 1. Fixed search_path on helper functions.
alter function public.is_counted(public.lesson_status) set search_path = public;
alter function public.force_majeure_extension_days() set search_path = public;
alter function public.level_to_band(text) set search_path = public;
alter function public.package_valid_until(public.packages) set search_path = public;

-- 2. Nobody calls the trigger functions directly; triggers still fire.
revoke execute on function public.lessons_before_write() from public, anon, authenticated;
revoke execute on function public.lessons_after_write() from public, anon, authenticated;

-- 3. Role helpers are needed by the access rules of signed-in users only.
--    They reveal nothing beyond the caller's own role.
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.has_role(variadic public.app_role[]) from public, anon;
revoke execute on function public.teaches_student(uuid) from public, anon;

-- 4. Tables and functions added later are closed to anonymous users too.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
