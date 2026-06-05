-- 024_backfill_promote_engagements.sql
-- Promote existing free-typed engagements to store staff records so they become
-- clickable in the dashboard and appear in the /staff roster. Each free-typed
-- visit_staff row (staff_id NULL, person_name set) gets a store staff record
-- (one per distinct store+name); the row is then linked and person_name cleared.
--
-- Verified against live data at authoring time: 15 free-typed rows, all distinct
-- (store, name), 0 matching an existing staff record, 0 same-name-twice-in-one-
-- visit collisions — so every row maps cleanly with no merge/collision handling.
-- Idempotent: re-running is a no-op once staff_id is set (WHERE staff_id IS NULL).
WITH freetyped AS (
  SELECT vs.id AS vs_id,
         v.store_id,
         btrim(vs.person_name)        AS nm,
         lower(btrim(vs.person_name)) AS nmkey
  FROM sva.visit_staff vs
  JOIN sva.visits v ON v.id = vs.visit_id
  WHERE vs.staff_id IS NULL
    AND vs.person_name IS NOT NULL
    AND btrim(vs.person_name) <> ''
),
distinct_people AS (
  SELECT DISTINCT store_id, nm, nmkey FROM freetyped
),
ins AS (
  INSERT INTO sva.staff (store_id, name)
  SELECT store_id, nm FROM distinct_people
  RETURNING id, store_id, lower(btrim(name)) AS nmkey
)
UPDATE sva.visit_staff vs
SET staff_id = ins.id, person_name = NULL
FROM freetyped f
JOIN ins ON ins.store_id = f.store_id AND ins.nmkey = f.nmkey
WHERE vs.id = f.vs_id;
