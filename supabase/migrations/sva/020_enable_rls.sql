-- 020_enable_rls.sql
-- Close the anon-key exposure: enable Row Level Security on every sva table.
-- The bot, dashboard, and miniapp all connect with the SERVICE ROLE key
-- (server-side only — no anon key exists in the codebase), and the service
-- role BYPASSES RLS. So RLS-on with NO policies = deny anon/authenticated,
-- allow service role. App behaviour is unchanged; the hole is shut.
--
-- NOTE: if a future feature ever uses the anon/authenticated key against these
-- tables, it will be denied until an explicit policy is added. That's the
-- correct secure default — add policies alongside any such feature.

ALTER TABLE sva.cms                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.stores               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.cm_store_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.staff                ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visits               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visit_staff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visit_photos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visit_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.insights             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.bot_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visit_cms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.visit_follow_ups     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.alert_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.memory_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.memory_edges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.intelligence_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.photo_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.photo_annotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.products             ENABLE ROW LEVEL SECURITY;

-- Temporary backup tables (dated copies) — lock these too.
ALTER TABLE sva.intelligence_reports_bak_20260603 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.memory_notes_bak_20260603         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sva.memory_edges_bak_20260603         ENABLE ROW LEVEL SECURITY;
