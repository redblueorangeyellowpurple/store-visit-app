-- 026_staff_profile_fields.sql
-- Richer store-staff profiles: let CMs record an age and a short profile/bio for
-- the store staff they engage (Feature 4 — Staff & Stores management).
--
-- ⚠️ NOT YET APPLIED. Authored for review — adding columns to the live `sva`
-- schema is a one-way change, and Wilson's rule is to confirm DB-column changes
-- first. Apply via Supabase MCP `apply_migration` (or the project's migration
-- flow) once approved. The staff-edit UI is intentionally NOT built yet, so this
-- is inert until both are shipped together.
--
-- `age` is stored directly (matches the ask). If a non-staling value is wanted
-- later, swap to `birthday date` and derive age in the app; left as a follow-up.

ALTER TABLE sva.staff
  ADD COLUMN IF NOT EXISTS age      SMALLINT CHECK (age IS NULL OR age BETWEEN 14 AND 100),
  ADD COLUMN IF NOT EXISTS bio      TEXT;
