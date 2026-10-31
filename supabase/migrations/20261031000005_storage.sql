-- Private file storage. Paths:
--   library/<file id>.pdf            school library, uploaded by owner or head teacher
--   private/<uploader id>/<file>     a teacher's own file for a lesson
-- Reading a stored file follows the files table rules: a person can open a
-- stored file only if they can see its row in public.files.

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)  -- 50 MB per file
on conflict (id) do nothing;

create policy files_bucket_read on storage.objects for select to authenticated
using (
  bucket_id = 'files'
  and exists (select 1 from public.files f where f.storage_path = storage.objects.name)
);

create policy files_bucket_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'files'
  and (
    (name like 'library/%' and public.has_role('owner', 'head_teacher'))
    or (name like 'private/' || auth.uid()::text || '/%'
        and public.has_role('owner', 'head_teacher', 'teacher'))
  )
);

create policy files_bucket_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'files'
  and (
    public.has_role('owner', 'head_teacher')
    or name like 'private/' || auth.uid()::text || '/%'
  )
);
