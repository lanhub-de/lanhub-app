-- Chat and homework file rules read ids from the folder names. Other buckets
-- have folders that are not ids ("library/…"), and the database may evaluate
-- the id part before the bucket check, so the cast must never fail.
create function public.try_uuid(t text) returns uuid
language sql immutable set search_path = public as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end
$$;

alter policy chat_files_read on storage.objects
using (bucket_id = 'chat' and public.can_chat(public.try_uuid((storage.foldername(name))[1])));
alter policy chat_files_upload on storage.objects
with check (bucket_id = 'chat' and public.can_chat(public.try_uuid((storage.foldername(name))[1])));

alter policy homework_files_read on storage.objects
using (
  bucket_id = 'homework'
  and (public.try_uuid((storage.foldername(name))[2]) in (select public.my_student_ids())
       or public.checks_lesson(public.try_uuid((storage.foldername(name))[1])))
);
alter policy homework_files_upload on storage.objects
with check (
  bucket_id = 'homework'
  and ((public.try_uuid((storage.foldername(name))[2]) in (select public.my_student_ids())
        and public.in_lesson(public.try_uuid((storage.foldername(name))[1]), public.try_uuid((storage.foldername(name))[2])))
       or public.checks_lesson(public.try_uuid((storage.foldername(name))[1])))
);
