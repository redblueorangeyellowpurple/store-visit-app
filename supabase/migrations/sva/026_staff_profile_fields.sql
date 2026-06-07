-- 026_staff_profile_fields.sql
-- Richer store-staff profiles: let CMs record an age and a short profile/bio for
-- the store staff they engage (Feature 4 — Staff & Stores management).
--
-- APPLIED 2026-06-07 (Wilson approved). Shipped together with the m/staff/[id]
-- detail screen + its profile-edit form (age + bio).
--
-- `age` is stored directly (matches the ask). If a non-staling value is wanted
-- later, swap to `birthday date` and derive age in the app; left as a follow-up.

ALTER TABLE sva.staff
  ADD COLUMN IF NOT EXISTS age      SMALLINT CHECK (age IS NULL OR age BETWEEN 14 AND 100),
  ADD COLUMN IF NOT EXISTS bio      TEXT;
