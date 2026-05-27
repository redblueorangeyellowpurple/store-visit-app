"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import NavBar from "@/components/NavBar";
import StoreVisitDrawer from "@/components/StoreVisitDrawer";
import MemoryNoteDrawer from "@/components/MemoryNoteDrawer";
import ChannelManagersSection from "@/components/ChannelManagersSection";

// Allow <details> and <summary> HTML tags through the sanitizer
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
};

interface User { first_name: string; username?: string }

interface ReportSummary {
  id: string;
  report_date: string;
  version: number;
  edited_by_human: boolean;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  stats: Record<string, unknown>;
  created_at: string;
}

interface ReportFull extends ReportSummary {
  brief_markdown: string;
}

interface NoteSummary {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  scope_ref: string;
  title: string;
  summary: string;
  version: number;
  tier: "short" | "long";
  last_touched_at: string;
  edited_by_human: boolean;
  related_slugs: string[];
}

type ScopeFilter = "all" | "theme" | "store" | "person" | "channel";
type TierFilter = "all" | "short" | "long";
type SortBy = "recent" | "updated" | "alpha";

const SCOPE_TABS: { value: ScopeFilter; label: string; icon: string }[] = [
  { value: "all", label: "All", icon: "✦" },
  { value: "theme", label: "Themes", icon: "🧵" },
  { value: "store", label: "Stores", icon: "🏬" },
  { value: "person", label: "People", icon: "👤" },
  { value: "channel", label: "Channels", icon: "🔗" },
];

const TIER_TABS: { value: TierFilter; label: string }[] = [
  { value: "all", label: "All tiers" },
  { value: "short", label: "Short-term" },
  { value: "long", label: "Long-term" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "updated", label: "Most updated" },
  { value: "alpha", label: "A–Z" },
];

function fmtDate(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateShort(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return fmtDateShort(iso);
}

/**
 * Strip legacy "## 📊 Analytics" sections from stored brief markdown.
 * The Channel Managers React component above the brief now shows this data live.
 * Old stored briefs may still contain the Analytics table — remove it at render time.
 */
function stripAnalyticsSection(md: string): string {
  // Matches from ## 📊 Analytics (or ## Analytics) to the next ## / # heading or end of string
  return md.replace(/\n## (?:📊 )?Analytics[\s\S]*?(?=\n## |\n# |$)/, "");
}

function stripBriefTitle(md: string): string {
  // Remove the leading H1 (e.g. "# 📍 Daily Intelligence Brief — 2026-05-26")
  // since we render it as the panel header above Channel Managers.
  return md.replace(/^#[^\n]*\n*/, "");
}

export default function IntelligencePage() {
  const [user, setUser] = useState<User | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [report, setReport] = useState<ReportFull | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [search, setSearch] = useState("");
  const [touchedOnly, setTouchedOnly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [drawerStoreId, setDrawerStoreId] = useState<string | null>(null);
  const [drawerNoteSlug, setDrawerNoteSlug] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUser(d));
  }, []);

  // Load report list once
  useEffect(() => {
    fetch("/api/intelligence/reports")
      .then((r) => r.json())
      .then((d) => {
        setReports(d.reports ?? []);
        if (d.reports?.[0]) setActiveDate(d.reports[0].report_date);
      });
  }, []);

  // Load notes once
  const loadNotes = useCallback(() => {
    fetch("/api/intelligence/notes")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []));
  }, []);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  // Load the active report whenever date changes
  useEffect(() => {
    if (!activeDate) return;
    setLoadingReport(true);
    setEditing(false);
    fetch(`/api/intelligence/reports/${activeDate}`)
      .then((r) => r.json())
      .then((d) => {
        setReport(d.report ?? null);
        setDraft(d.report?.brief_markdown ?? "");
      })
      .finally(() => setLoadingReport(false));
  }, [activeDate]);

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = notes.slice();
    if (scope !== "all") out = out.filter((n) => n.scope === scope);
    if (tier !== "all") out = out.filter((n) => n.tier === tier);
    if (touchedOnly && activeDate) {
      out = out.filter((n) => n.last_touched_at.slice(0, 10) === activeDate);
    }
    if (q) {
      out = out.filter(
        (n) => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q),
      );
    }
    if (sortBy === "recent") {
      out.sort((a, b) => b.last_touched_at.localeCompare(a.last_touched_at));
    } else if (sortBy === "updated") {
      out.sort((a, b) => b.version - a.version || b.last_touched_at.localeCompare(a.last_touched_at));
    } else {
      out.sort((a, b) => a.title.localeCompare(b.title));
    }
    return out;
  }, [notes, scope, tier, sortBy, search, touchedOnly, activeDate]);

  const touchedCount = useMemo(() => {
    if (!activeDate) return 0;
    return notes.filter((n) => n.last_touched_at.slice(0, 10) === activeDate).length;
  }, [notes, activeDate]);

  async function saveEdit() {
    if (!activeDate) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/intelligence/reports/${activeDate}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_markdown: draft }),
      });
      const data = await res.json();
      if (res.ok && data.report) {
        setReport(data.report);
        // refresh list so the version badge updates
        const list = await fetch("/api/intelligence/reports").then((r) => r.json());
        setReports(list.reports ?? []);
        setEditing(false);
      } else {
        alert(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <NavBar user={user as { first_name: string; username?: string }} />
      <main className="page-content space-y-8">
        {/* Header */}
        <header>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--color-ink-900)" }}>
                Daily Intelligence
              </h1>
              <p className="text-[13px] mt-0.5" style={{ color: "var(--color-ink-300)" }}>
                Lean synthesis of every store visit, with memory that compounds over time
              </p>
            </div>
            {report && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={{ background: "var(--color-tc-50)", color: "var(--color-tc-600)" }}
              >
                Edit brief
              </button>
            )}
          </div>

          {/* Date chips */}
          {reports.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {reports.slice(0, 14).map((r) => {
                const isActive = r.report_date === activeDate;
                return (
                  <button
                    key={r.report_date}
                    onClick={() => setActiveDate(r.report_date)}
                    className="rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      background: isActive ? "var(--color-tc-500)" : "var(--color-ink-50)",
                      color: isActive ? "#fff" : "var(--color-ink-500)",
                      fontWeight: isActive ? 700 : 500,
                    }}
                  >
                    {fmtDateShort(r.report_date)}
                    {r.edited_by_human && <span className="ml-1 opacity-75">✎</span>}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Brief */}
        <section
          className="rounded-2xl p-6"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          {/* Panel header — derived from selected date */}
          {activeDate && (
            <h2 className="text-xl font-black tracking-tight mb-4" style={{ color: "var(--color-ink-900)" }}>
              Daily Intelligence — {activeDate}
            </h2>
          )}

          {/* Channel Managers — live visit analytics for the selected date */}
          <ChannelManagersSection
            date={activeDate}
            onOpenStore={(id) => setDrawerStoreId(id)}
          />

          {loadingReport && (
            <p className="text-[13px]" style={{ color: "var(--color-ink-300)" }}>Loading…</p>
          )}
          {!loadingReport && !report && (
            <div className="py-10 text-center">
              <p className="text-[13px]" style={{ color: "var(--color-ink-300)" }}>
                No reports yet. Run <code className="px-1.5 py-0.5 rounded bg-black/5">npm run intelligence</code> to generate the first one.
              </p>
            </div>
          )}
          {!loadingReport && report && !editing && (
            <>
              <hr style={{ borderColor: "var(--color-border)", margin: "1.25rem 0" }} />
              <div className="flex items-center gap-2 text-[11px] mb-4" style={{ color: "var(--color-ink-300)" }}>
                <span>v{report.version}</span>
                {report.edited_by_human && (
                  <span className="rounded-full px-2 py-0.5" style={{ background: "var(--color-tc-50)", color: "var(--color-tc-600)" }}>
                    ✎ edited
                  </span>
                )}
                {report.model && <span>· {report.model}</span>}
                {report.prompt_tokens && (
                  <span>· {report.prompt_tokens.toLocaleString()} in / {report.completion_tokens?.toLocaleString()} out</span>
                )}
              </div>
              <div className="markdown-brief">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                  components={{
                    // Intercept /visits/store/[id] links → open drawer
                    a({ href, children, ...props }) {
                      const match = href?.match(/^\/visits\/store\/([^/?#]+)/);
                      if (match) {
                        return (
                          <button
                            onClick={() => setDrawerStoreId(match[1])}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              color: "var(--color-tc-600)",
                              fontWeight: 600,
                              fontSize: "inherit",
                              fontFamily: "inherit",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                            }}
                          >
                            {children}
                          </button>
                        );
                      }
                      return <a href={href} {...props}>{children}</a>;
                    },
                  }}
                >
                  {stripBriefTitle(stripAnalyticsSection(report.brief_markdown))}
                </ReactMarkdown>
              </div>
            </>
          )}
          {editing && report && (
            <div className="space-y-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(40, Math.max(20, draft.split("\n").length + 2))}
                className="w-full font-mono text-[12px] p-4 rounded-xl"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-ink-50)",
                  color: "var(--color-ink-900)",
                  lineHeight: 1.5,
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: "var(--color-tc-500)" }}
                >
                  {saving ? "Saving…" : "Save as new version"}
                </button>
                <button
                  onClick={() => { setEditing(false); setDraft(report.brief_markdown); }}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium"
                  style={{ color: "var(--color-ink-500)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Memory */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-black tracking-tight" style={{ color: "var(--color-ink-900)" }}>
              Memory
            </h2>
            <p className="text-[11px]" style={{ color: "var(--color-ink-300)" }}>
              {notes.length} notes · {notes.filter((n) => n.tier === "short").length} active
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {SCOPE_TABS.map((tab) => {
              const isActive = scope === tab.value;
              const count = tab.value === "all" ? notes.length : notes.filter((n) => n.scope === tab.value).length;
              return (
                <button
                  key={tab.value}
                  onClick={() => setScope(tab.value)}
                  className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    background: isActive ? "var(--color-tc-50)" : "transparent",
                    color: isActive ? "var(--color-tc-600)" : "var(--color-ink-500)",
                    fontWeight: isActive ? 700 : 500,
                  }}
                >
                  <span className="mr-1">{tab.icon}</span>
                  {tab.label}
                  <span className="ml-1.5 opacity-60">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Filter bar: search + sort + tier chips + touched-in-brief toggle */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or summary…"
              className="rounded-lg px-3 py-1.5 text-[12px] flex-1 min-w-[180px]"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-ink-900)",
              }}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg px-2 py-1.5 text-[12px] font-medium"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-ink-700)",
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>Sort: {o.label}</option>
              ))}
            </select>
            <div className="flex gap-1">
              {TIER_TABS.map((t) => {
                const isActive = tier === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => setTier(t.value)}
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: isActive ? "var(--color-tc-50)" : "transparent",
                      color: isActive ? "var(--color-tc-600)" : "var(--color-ink-500)",
                      fontWeight: isActive ? 700 : 500,
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {activeDate && (
              <button
                onClick={() => setTouchedOnly((v) => !v)}
                disabled={touchedCount === 0}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                style={{
                  background: touchedOnly ? "var(--color-tc-500)" : "transparent",
                  color: touchedOnly ? "#fff" : "var(--color-ink-500)",
                  border: "1px solid var(--color-border)",
                  fontWeight: touchedOnly ? 700 : 500,
                }}
                title={`${touchedCount} notes touched by the ${fmtDateShort(activeDate)} brief`}
              >
                🔗 Touched in this brief
                <span className="ml-1 opacity-75">{touchedCount}</span>
              </button>
            )}
          </div>

          <div className="grid gap-2">
            {filteredNotes.map((n) => (
              <button
                key={n.slug}
                onClick={() => setDrawerNoteSlug(n.slug)}
                className="rounded-xl p-4 transition-all hover:-translate-y-0.5 text-left"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                        style={{
                          background:
                            n.scope === "theme"
                              ? "var(--color-section-purple-bg)"
                              : n.scope === "store"
                              ? "var(--color-section-green-bg)"
                              : n.scope === "person"
                              ? "var(--color-section-blue-bg)"
                              : "var(--color-ink-50)",
                          color: "var(--color-ink-700)",
                        }}
                      >
                        {n.scope}
                      </span>
                      <span className="text-[13px] font-bold" style={{ color: "var(--color-ink-900)" }}>
                        {n.title}
                      </span>
                      {n.edited_by_human && (
                        <span className="text-[10px]" style={{ color: "var(--color-tc-600)" }}>✎</span>
                      )}
                      {n.tier === "long" && (
                        <span className="text-[10px]" style={{ color: "var(--color-ink-300)" }}>· long-term</span>
                      )}
                    </div>
                    <p className="text-[12.5px] leading-snug" style={{ color: "var(--color-ink-500)" }}>
                      {n.summary}
                    </p>
                  </div>
                  <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-ink-300)" }}>
                    {fmtRelative(n.last_touched_at)}
                  </span>
                </div>
              </button>
            ))}
            {filteredNotes.length === 0 && (
              <p className="text-[13px] text-center py-6" style={{ color: "var(--color-ink-300)" }}>
                {search || tier !== "all" || touchedOnly
                  ? "No notes match the current filters."
                  : `No ${scope === "all" ? "" : scope} notes yet.`}
              </p>
            )}
          </div>
        </section>


        <p className="text-[11px] pt-4" style={{ color: "var(--color-ink-300)" }}>
          {activeDate && fmtDate(activeDate)} · Generated daily from locked store visits
        </p>
      </main>

      <StoreVisitDrawer
        storeId={drawerStoreId}
        onClose={() => setDrawerStoreId(null)}
        onOpenNote={(slug) => setDrawerNoteSlug(slug)}
      />

      <MemoryNoteDrawer
        slug={drawerNoteSlug}
        onClose={() => setDrawerNoteSlug(null)}
      />
    </>
  );
}
