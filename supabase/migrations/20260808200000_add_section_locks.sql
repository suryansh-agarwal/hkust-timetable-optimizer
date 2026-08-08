-- Per-course section pins, one per component type:
--   {"MATH 1003": {"lecture": "L1", "tutorial": "T1B"}}
-- Sits alongside instructor_locks rather than replacing it, so the professor
-- lock shipped in 6bf408d keeps working with no data migration.
alter table public.user_course_selections
  add column if not exists section_locks jsonb not null default '{}'::jsonb;
