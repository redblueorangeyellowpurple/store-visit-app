"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Note {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  title: string;
  summary: string;
  body_markdown: string;
  related_slugs: string[];
  version: number;
  tier: "short" | "long";
  last_touched_at: string;
  edited_by_human: boolean;
}

interface HistoryEntry {
  version: number;
  edited_by_human: boolean;
  created_at: string;
}

interface RelatedNote {
  slug: string;
  title: string;
  summary: string;
}

interface EdgeRow {
  from_slug: string;
  to_slug: string;
  edge_type: string;
}

interface Props {
  slug: string | null;
  onClose: () => void;
  onOpenStore?: (storeId: string) => void;
  onOpenVisit?: (visitId: string) => void;
}

const SCOPE_BG: Record<string, string> = {
  theme:   "var(--color-section-purple-bg)",
  store:   "var(--color-section-green-bg)",
  person:  "var(--color-section-blue-bg)",
  channel: "var(--color-ink-50)",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Link interceptor for body_markdown links inside a memory note.
function mdLinkComponents(
  onOpenStore: ((id: string) => void) | undefined,
  onOpenVisit: ((id: string) => void) | undefined,
) {
  return {
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      const visitMatch = href?.match(/^\/visits\/visit\/([^/?#]+)\/([^/?#]+)/);
      if (visitMatch && onOpenVisit) {
        return (
          <button
            onClick={() => onOpenVisit(visitMatch[2])}
            style={{ fontSize: "inherit", color: "var(--color-tc-600)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
          >
            {children}
          </button>
        );
      }
      const storeMatch = href?.match(/^\/visits\/store\/([^/?#]+)/);
      if (storeMatch && onOpenStore) {
        return (
          <button
            onClick={() => onOpenStore(storeMatch[1])}
            style={{ fontSize: "inherit", color: "var(--color-tc-600)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
          >
            {children}
          </button>
        );
      }
      return <a href={href}>{children}</a>;
    },
  };
}

export default function MemoryNoteDrawer({ slug, onClose, onOpenStore, onOpenVisit }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");
  const [relatedDraft, setRelatedDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Track which slug is currently loaded so we avoid duplicate fetches
  const loadedSlug = useRef<string | null>(null);

  const isOpen = slug !== null;

  const load = useCallback(async (s: string) => {
    setNote(null);
    setRelated([]);
    setEdges([]);
    setHistory([]);
    setEditing(false);
    setLoading(true);
    const res = await fetch(`/api/intelligence/notes/${encodeURIComponent(s)}`);
    if (res.ok) {
      const data = await res.json();
      setNote(data.note ?? null);
      setHistory(data.history ?? []);
      setRelated(data.related ?? []);
      setEdges(data.edges ?? []);
      if (data.note) {
        setSummaryDraft(data.note.summary ?? "");
        setBodyDraft(data.note.body_markdown ?? "");
        setRelatedDraft((data.note.related_slugs ?? []).join(", "));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!slug) { loadedSlug.current = null; return; }
    if (slug === loadedSlug.current) return;
    loadedSlug.current = slug;
    load(slug);
  }, [slug, load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  async function saveEdit() {
    if (!slug) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/intelligence/notes/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: summaryDraft.trim(),
          body_markdown: bodyDraft,
          related_slugs: relatedDraft.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok && data.note) {
        setEditing(false);
        loadedSlug.current = null; // force re-fetch
        await load(slug);
      } else {
        alert(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  function navigateTo(newSlug: string) {
    loadedSlug.current = null;
    load(newSlug);
    // Tell parent to update the slug prop so the drawer stays in sync
    // We fire a synthetic close+reopen. Simpler: parent tracks activeNoteSlug.
    // Since we can't call setSlug from here, we'll re-fetch internally and
    // keep the drawer open — this is a local navigation.
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 520,
        zIndex: 250,
        background: "var(--color-surface)",
        borderLeft: "1px solid var(--color-border)",
        boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.12)" : "none",
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {loading && (
            <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>Loading…</p>
          )}
          {!loading && note && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                    background: SCOPE_BG[note.scope] ?? "var(--color-ink-50)",
                    color: "var(--color-ink-700)", textTransform: "uppercase", letterSpacing: "0.5px",
                  }}
                >
                  {note.scope}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-ink-300)", fontFamily: "monospace" }}>
                  {note.slug}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-ink-300)" }}>· v{note.version}</span>
                {note.edited_by_human && (
                  <span style={{ fontSize: 10, color: "var(--color-tc-600)" }}>· ✎ edited</span>
                )}
              </div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.25, marginBottom: 3 }}>
                {note.title}
              </p>
              <p style={{ fontSize: 12.5, color: "var(--color-ink-500)", lineHeight: 1.4 }}>
                {note.summary}
              </p>
            </>
          )}
          {!loading && !note && (
            <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>Note not found.</p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {note && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                padding: "5px 10px", borderRadius: 8, border: "none", cursor: "pointer",
                background: "var(--color-tc-50)", color: "var(--color-tc-600)",
                fontSize: 11, fontWeight: 700, fontFamily: "inherit",
              }}
            >
              Edit
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              padding: "4px 8px", borderRadius: 8,
              background: "var(--color-ink-50)", border: "none",
              cursor: "pointer", fontSize: 16, lineHeight: 1,
              color: "var(--color-ink-500)",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: "auto", flex: 1, padding: "20px 20px 40px" }}>
        {note && !editing && (
          <>
            {/* Body markdown */}
            <div className="markdown-brief" style={{ fontSize: 13 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdLinkComponents(onOpenStore, onOpenVisit)}
              >{note.body_markdown}</ReactMarkdown>
            </div>

            {/* Related notes */}
            {related.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 8 }}>
                  Related notes
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {related.map((r) => (
                    <button
                      key={r.slug}
                      onClick={() => navigateTo(r.slug)}
                      style={{
                        textAlign: "left", padding: "10px 12px", borderRadius: 10,
                        background: "var(--color-ink-50)",
                        border: "1px solid var(--color-border)",
                        cursor: "pointer",
                      }}
                    >
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-900)", marginBottom: 2 }}>
                        {r.title}
                      </p>
                      <p style={{ fontSize: 11.5, color: "var(--color-ink-500)" }}>
                        {r.summary}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Edges */}
            {edges.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 6 }}>
                  Edges ({edges.length})
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                  {edges.map((e, i) => (
                    <li key={i} style={{ fontSize: 10.5, fontFamily: "monospace", color: "var(--color-ink-400)" }}>
                      {e.from_slug} <span style={{ color: "var(--color-ink-500)" }}>—{e.edge_type}→</span> {e.to_slug}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Version history */}
            {history.length > 1 && (
              <div style={{ marginTop: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 6 }}>
                  History ({history.length} versions)
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                  {history.map((h) => (
                    <li key={h.version} style={{ fontSize: 11.5, color: "var(--color-ink-400)", display: "flex", gap: 8 }}>
                      <span style={{ fontFamily: "monospace" }}>v{h.version}</span>
                      <span>·</span>
                      <span>{fmtDateTime(h.created_at)}</span>
                      {h.edited_by_human && (
                        <span style={{ color: "var(--color-tc-600)" }}>✎ human</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Edit mode */}
        {note && editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 4 }}>
                Summary (one-liner, always read by Claude)
              </label>
              <input
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                style={{
                  width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--color-border)", background: "var(--color-ink-50)",
                  color: "var(--color-ink-900)", fontFamily: "inherit",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 4 }}>
                Body (markdown)
              </label>
              <textarea
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                rows={Math.min(30, Math.max(12, bodyDraft.split("\n").length + 2))}
                style={{
                  width: "100%", fontFamily: "monospace", fontSize: 11.5,
                  padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--color-border)", background: "var(--color-ink-50)",
                  color: "var(--color-ink-900)", lineHeight: 1.5, resize: "vertical",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 4 }}>
                Related slugs (comma-separated)
              </label>
              <input
                value={relatedDraft}
                onChange={(e) => setRelatedDraft(e.target.value)}
                placeholder="theme:jbl-pressure-sg, store:..."
                style={{
                  width: "100%", fontSize: 12, fontFamily: "monospace",
                  padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--color-border)", background: "var(--color-ink-50)",
                  color: "var(--color-ink-900)",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "var(--color-tc-500)", color: "white",
                  fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                  opacity: saving ? 0.5 : 1,
                }}
              >
                {saving ? "Saving…" : "Save as new version"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  if (note) {
                    setSummaryDraft(note.summary);
                    setBodyDraft(note.body_markdown);
                    setRelatedDraft(note.related_slugs.join(", "));
                  }
                }}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "transparent", color: "var(--color-ink-500)",
                  fontSize: 12, fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
