-- What a student sees on a lesson page, as in the Notion course hubs:
-- the grammar topic, what they can do afterwards, what to do after class,
-- links to earlier lessons, and the slides.
alter table public.program_lessons
  add column topic text,
  add column goal text,
  add column after_note text,
  add column connected text,
  add column slides_url text;
