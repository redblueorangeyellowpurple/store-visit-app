-- 032_memory_audience.sql — two-lens memory: tag note versions by audience.
-- Promoter intel (promotchi.intel_*) and CM visits feed the SAME memory graph;
-- audience controls which synthesis/report reads a note:
--   cm            = Channel Manager intelligence (default; all pre-existing rows)
--   promoter_dept = Promoter Department lens (promoter performance, coaching)
--   shared        = facts both lenses need (store/channel notes trend here)
-- Audience is per-version: writers must carry it forward when bumping a note.

ALTER TABLE sva.memory_notes
  ADD COLUMN audience text NOT NULL DEFAULT 'cm'
  CHECK (audience IN ('cm','promoter_dept','shared'));

-- Recreate view: new column lands before computed tier, so OR REPLACE won't do.
DROP VIEW IF EXISTS sva.v_memory_notes_current;
CREATE VIEW sva.v_memory_notes_current AS
SELECT DISTINCT ON (slug)
  id, slug, scope, scope_ref, title, summary, body_markdown, related_slugs,
  version, last_touched_at, edited_by_human, created_at, audience,
  CASE
    WHEN last_touched_at >= now() - interval '14 days' THEN 'short'
    ELSE 'long'
  END AS tier
FROM sva.memory_notes
ORDER BY slug, version DESC;
