-- Per-course professor locks, keyed by course code:
--   {"COMP 2011": "LI, Xin", "ECON 2103": "KELLER, Wolfgang"}
-- Additive with a default so existing rows and the current upsert keep working.
alter table public.user_course_selections
  add column if not exists instructor_locks jsonb not null default '{}'::jsonb;
