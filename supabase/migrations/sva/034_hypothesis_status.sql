-- 034_hypothesis_status.sql — hypothesis lifecycle on memory notes.
-- A hypothesis is a theme note with a status; regular notes keep status NULL.
--   watch     = 1-2 sightings, system actively looks to confirm/refute
--   confirmed = 3+ distinct-day sightings OR corroborated by both lenses
--   actioned  = a human acted on it (set by humans only, never the routine)
--   dead      = refuted, or no new sighting in 30 days
-- Status is per-version: writers carry it forward (see insertMemoryNoteVersion).

ALTER TABLE sva.memory_notes
  ADD COLUMN status text
  CHECK (status IN ('watch','confirmed','actioned','dead'));

DROP VIEW IF EXISTS sva.v_memory_notes_current;
CREATE VIEW sva.v_memory_notes_current AS
SELECT DISTINCT ON (slug)
  id, slug, scope, scope_ref, title, summary, body_markdown, related_slugs,
  version, last_touched_at, edited_by_human, created_at, audience, status,
  CASE
    WHEN last_touched_at >= now() - interval '14 days' THEN 'short'
    ELSE 'long'
  END AS tier
FROM sva.memory_notes
ORDER BY slug, version DESC;
