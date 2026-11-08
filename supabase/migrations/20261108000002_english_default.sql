-- English is the default interface language; anyone can switch to Ukrainian.
alter table public.profiles alter column locale set default 'en';
alter table public.students alter column locale set default 'en';
alter table public.invites alter column locale set default 'en';
update public.invites set locale = 'en' where accepted_at is null;
