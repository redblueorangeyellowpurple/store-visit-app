"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
}

interface PhotoComment { id: string; body: string; author_name: string | null; created_at: string }
interface PhotoAnnotation { id: string; x: number; y: number; w: number; h: number; note: string; author_name: string | null; created_at: string }

interface PhotoItem {
  id: string;
  url: string;
  section_key: string | null;
  grade: number | null;
  comments: PhotoComment[];
  annotations: PhotoAnnotation[];
}

interface StoreVisit {
  id: string;
  visit_date: string;
  cm_name: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  photo_count: number;
  thumb_urls: string[];
  photo_urls: string[];
  photos: PhotoItem[];
}

interface FlatPhoto { id: string; url: string; section_key: string | null; visit_id: string; visit_date: string; cm_name: string }
interface ReviewState { grade: number | null; comments: PhotoComment[]; annotations: PhotoAnnotation[] }
interface User { first_name: string; username?: string }

type DragMode = "draw" | "move" | "resize";
interface DragState { mode: DragMode; id: string; corner?: string; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }

const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

const SECTIONS = [
  { key: "good_news",     label: "Good News",             icon: "🌟", color: "var(--color-tc-600)" },
  { key: "competitors",   label: "Competitors' Insights", icon: "🔍", color: "var(--color-tier-t1-fg)" },
  { key: "display_stock", label: "Display & Stock",       icon: "📦", color: "var(--color-tier-t2-fg)" },
  { key: "follow_up",     label: "What to Follow Up",     icon: "✅", color: "#C0185A" },
  { key: "buzz_plan",     label: "Buzz Plan",             icon: "⚡", color: "#5B2DB5" },
] as const;

const SECTION_TAG: Record<string, string> = {
  display_stock: "Display", competitor: "Competitor", good_news: "Good News",
  people_training: "Training", follow_up: "Follow-up",
};

const GRADES: Record<number, { label: string; cls: string }> = {
  1: { label: "Good", cls: "g1" }, 2: { label: "Needs work", cls: "g2" }, 3: { label: "Poor", cls: "g3" },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function mondayOf(iso: string): Date {
  const d = new Date(iso + "T00:00:00"); d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return d;
}
function weekLabel(mon: Date): string {
  const end = new Date(mon); end.setDate(mon.getDate() + 6);
  const day = (x: Date) => x.getDate();
  const mo = (x: Date) => x.toLocaleDateString("en-GB", { month: "short" });
  return mon.getMonth() === end.getMonth()
    ? `${day(mon)}–${day(end)} ${mo(end)} ${end.getFullYear()}`
    : `${day(mon)} ${mo(mon)} – ${day(end)} ${mo(end)} ${end.getFullYear()}`;
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));
function api(url: string, method: string, body: unknown) {
  return fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export default function StoreDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [user,        setUser]        = useState<User | null>(null);
  const [store,       setStore]       = useState<StoreInfo | null>(null);
  const [visits,      setVisits]      = useState<StoreVisit[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [galleryMode, setGalleryMode] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [reviews,     setReviews]     = useState<Record<string, ReviewState>>({});
  const [activeAnn,   setActiveAnn]   = useState<string | null>(null);
  const [composer,    setComposer]    = useState<{ id: string; isNew: boolean; left: number; top: number; text: string } | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [aspect,      setAspect]      = useState<number | null>(null);
  const [showReport,  setShowReport]  = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const tmpId = useRef(0);
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/visits/store/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setStore(d.store); setVisits(d.visits); } setLoading(false); });
  }, [id]);

  // Seed the editable review map from the loaded photos.
  useEffect(() => {
    const map: Record<string, ReviewState> = {};
    for (const v of visits) for (const p of v.photos) {
      map[p.id] = { grade: p.grade, comments: p.comments, annotations: p.annotations };
    }
    setReviews(map);
  }, [visits]);

  const allPhotos: FlatPhoto[] = visits.flatMap(v =>
    v.photos.map(p => ({ id: p.id, url: p.url, section_key: p.section_key, visit_id: v.id, visit_date: v.visit_date, cm_name: v.cm_name })),
  );
  const active = lightboxIdx !== null ? allPhotos[lightboxIdx] : null;

  const closeLb = useCallback(() => setLightboxIdx(null), []);
  const nav = useCallback((delta: number) => {
    setLightboxIdx(i => (i === null ? i : (i + delta + allPhotos.length) % allPhotos.length));
  }, [allPhotos.length]);

  // Reset transient review UI when the open photo changes.
  useEffect(() => { setActiveAnn(null); setComposer(null); setAspect(null); }, [lightboxIdx]);

  const pct = useCallback((e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * 100), y: clamp((e.clientY - r.top) / r.height * 100) };
  }, []);

  const setAnns = useCallback((photoId: string, fn: (a: PhotoAnnotation[]) => PhotoAnnotation[]) => {
    setReviews(rs => ({ ...rs, [photoId]: { ...rs[photoId], annotations: fn(rs[photoId]?.annotations ?? []) } }));
  }, []);

  const openComposer = useCallback((annId: string, isNew: boolean) => {
    const wrap = wrapRef.current; if (!wrap || !active) return;
    const box = reviewsRef.current[active.id]?.annotations.find(a => a.id === annId); if (!box) return;
    const ir = wrap.getBoundingClientRect();
    const bx = ir.left + ir.width * box.x / 100, by = ir.top + ir.height * box.y / 100;
    const bw = ir.width * box.w / 100, bh = ir.height * box.h / 100;
    const cw = 266, chh = 168, pad = 10;
    let left = bx; if (left + cw > ir.right - pad) left = ir.right - pad - cw; if (left < ir.left + pad) left = ir.left + pad;
    let top = by + bh + 8;
    if (top + chh > ir.bottom - pad) { top = by - chh - 8; if (top < ir.top + pad) top = ir.bottom - chh - pad; if (top < ir.top + pad) top = ir.top + pad; }
    setComposer({ id: annId, isNew, left, top, text: box.note || "" });
  }, [active]);

  const deleteAnn = useCallback((annId: string) => {
    if (!active) return;
    if (!annId.startsWith("tmp-")) api(`/api/photos/${active.id}/annotations`, "DELETE", { annotationId: annId });
    setAnns(active.id, arr => arr.filter(a => a.id !== annId));
    setActiveAnn(null); setComposer(null);
  }, [active, setAnns]);

  // Global drag handlers for draw / move / resize.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = drag.current; if (!d || !active) return;
      const cur = pct(e); const o = d.orig;
      setAnns(active.id, arr => arr.map(a => {
        if (a.id !== d.id) return a;
        if (d.mode === "draw") return { ...a, x: Math.min(d.startX, cur.x), y: Math.min(d.startY, cur.y), w: Math.abs(cur.x - d.startX), h: Math.abs(cur.y - d.startY) };
        if (d.mode === "move") return { ...a, x: Math.min(clamp(o.x + (cur.x - d.startX)), 100 - o.w), y: Math.min(clamp(o.y + (cur.y - d.startY)), 100 - o.h) };
        let { x, y, w, h } = o; const r = x + w, b = y + h; const c = d.corner!;
        if (c.includes("w")) { x = Math.min(cur.x, r); w = r - x; }
        if (c.includes("n")) { y = Math.min(cur.y, b); h = b - y; }
        if (c.includes("e")) { w = Math.max(0, cur.x - x); }
        if (c.includes("s")) { h = Math.max(0, cur.y - y); }
        return { ...a, x, y, w, h };
      }));
    }
    function onUp() {
      const d = drag.current; if (!d) return; drag.current = null;
      if (!active) return;
      const box = reviewsRef.current[active.id]?.annotations.find(a => a.id === d.id);
      if (d.mode === "draw") {
        if (!box || box.w < 2 || box.h < 2) { setAnns(active.id, arr => arr.filter(a => a.id !== d.id)); setActiveAnn(null); return; }
        openComposer(d.id, true);
      } else if (box && !box.id.startsWith("tmp-")) {
        api(`/api/photos/${active.id}/annotations`, "PATCH", { annotationId: box.id, x: box.x, y: box.y, w: box.w, h: box.h });
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [active, pct, setAnns, openComposer]);

  // Keyboard: arrows, escape, delete selected box.
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || composer) return;
      if ((e.key === "Backspace" || e.key === "Delete") && activeAnn) { e.preventDefault(); deleteAnn(activeAnn); return; }
      if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
      else if (e.key === "Escape") { if (activeAnn) setActiveAnn(null); else closeLb(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, nav, closeLb, composer, activeAnn, deleteAnn]);

  if (!user) return null;

  const tier = store?.tier ?? null;
  const ts = tier ? TIER_STYLE[tier] : TIER_STYLE.T4;
  const hasPhotos = allPhotos.length > 0;
  const review = active ? (reviews[active.id] ?? { grade: null, comments: [], annotations: [] }) : null;

  const weekGroups: { key: string; label: string; photos: FlatPhoto[] }[] = [];
  const weekIdx = new Map<string, number>();
  for (const fp of allPhotos) {
    const key = isoDate(mondayOf(fp.visit_date));
    let gi = weekIdx.get(key);
    if (gi === undefined) { gi = weekGroups.length; weekIdx.set(key, gi); weekGroups.push({ key, label: weekLabel(mondayOf(fp.visit_date)), photos: [] }); }
    weekGroups[gi].photos.push(fp);
  }

  const hasReview = Object.values(reviews).some(r => r.grade || r.annotations.length || r.comments.length);

  // Build the report: weeks → reviewed photos (only those with a grade, fix, or comment).
  function buildReport() {
    return weekGroups.map(g => ({
      label: g.label,
      photos: g.photos
        .map(fp => ({ fp, r: reviews[fp.id] }))
        .filter(({ r }) => r && (r.grade || r.annotations.length || r.comments.length))
        .map(({ fp, r }) => ({ fp, grade: r.grade, fixes: r.annotations, comments: r.comments })),
    })).filter(g => g.photos.length > 0);
  }

  function copyReportText() {
    const rep = buildReport();
    const lines: string[] = [`Display Feedback — ${store?.name ?? ""}`, `Generated ${fmtDate(new Date().toISOString())}`, ""];
    for (const wk of rep) {
      lines.push(wk.label);
      for (const p of wk.photos) {
        const tag = p.fp.section_key && SECTION_TAG[p.fp.section_key] ? `${SECTION_TAG[p.fp.section_key]} photo` : "Photo";
        const grade = p.grade ? ` — ${GRADES[p.grade].label}` : "";
        lines.push(`  • ${tag} (${fmtDate(p.fp.visit_date)}, ${p.fp.cm_name})${grade}`);
        p.fixes.forEach((f, i) => lines.push(`      ${i + 1}. ${f.note}`));
        if (p.comments.length) lines.push(`      Notes: ${p.comments.map(c => c.body).join("; ")}`);
      }
      lines.push("");
    }
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  // ── reviewer actions ──
  function onBgDown(e: React.MouseEvent) {
    if (!active || e.button !== 0) return;
    const start = pct(e);
    const tid = `tmp-${tmpId.current++}`;
    setAnns(active.id, arr => [...arr, { id: tid, x: start.x, y: start.y, w: 0, h: 0, note: "", author_name: null, created_at: "" }]);
    setActiveAnn(tid);
    drag.current = { mode: "draw", id: tid, startX: start.x, startY: start.y, orig: { x: start.x, y: start.y, w: 0, h: 0 } };
  }
  function onBoxDown(e: React.MouseEvent, a: PhotoAnnotation) {
    e.stopPropagation(); if (e.button !== 0) return;
    setActiveAnn(a.id);
    const s = pct(e);
    drag.current = { mode: "move", id: a.id, startX: s.x, startY: s.y, orig: { x: a.x, y: a.y, w: a.w, h: a.h } };
  }
  function onHandleDown(e: React.MouseEvent, a: PhotoAnnotation, corner: string) {
    e.stopPropagation(); if (e.button !== 0) return;
    setActiveAnn(a.id);
    const s = pct(e);
    drag.current = { mode: "resize", corner, id: a.id, startX: s.x, startY: s.y, orig: { x: a.x, y: a.y, w: a.w, h: a.h } };
  }
  async function composerSave() {
    if (!composer || !active) return;
    const text = composer.text.trim(); if (!text) return composerCancel();
    const box = reviewsRef.current[active.id]?.annotations.find(a => a.id === composer.id); if (!box) return;
    if (composer.isNew) {
      const res = await api(`/api/photos/${active.id}/annotations`, "POST", { x: box.x, y: box.y, w: box.w, h: box.h, note: text });
      if (res.ok) {
        const saved = await res.json() as PhotoAnnotation;
        setAnns(active.id, arr => arr.map(a => a.id === composer.id ? saved : a));
        setActiveAnn(saved.id);
      }
    } else {
      api(`/api/photos/${active.id}/annotations`, "PATCH", { annotationId: composer.id, note: text });
      setAnns(active.id, arr => arr.map(a => a.id === composer.id ? { ...a, note: text } : a));
    }
    setComposer(null);
  }
  function composerCancel() {
    if (composer?.isNew && active) { setAnns(active.id, arr => arr.filter(a => a.id !== composer.id)); setActiveAnn(null); }
    setComposer(null);
  }
  function setGrade(n: number) {
    if (!active) return;
    const next = review?.grade === n ? null : n;
    setReviews(rs => ({ ...rs, [active.id]: { ...rs[active.id], grade: next } }));
    api(`/api/photos/${active.id}/grade`, "PATCH", { grade: next });
  }
  async function addComment() {
    if (!active) return;
    const body = commentInput.trim(); if (!body) return;
    setCommentInput("");
    const res = await api(`/api/photos/${active.id}/comments`, "POST", { body });
    if (res.ok) {
      const saved = await res.json() as PhotoComment;
      setReviews(rs => ({ ...rs, [active.id]: { ...rs[active.id], comments: [...(rs[active.id]?.comments ?? []), saved] } }));
    }
  }
  function deleteComment(cid: string) {
    if (!active) return;
    api(`/api/photos/${active.id}/comments`, "DELETE", { commentId: cid });
    setReviews(rs => ({ ...rs, [active.id]: { ...rs[active.id], comments: (rs[active.id]?.comments ?? []).filter(c => c.id !== cid) } }));
  }

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content" style={{ maxWidth: 900 }}>
        <Link href="/visits" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--color-ink-400)", fontWeight: 600, marginBottom: 20, textDecoration: "none" }}>
          ‹ Store Updates
        </Link>

        {loading ? (
          <div className="empty-state"><p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p></div>
        ) : !store ? (
          <div className="empty-state"><p className="empty-state-icon">🏪</p><p>Store not found.</p></div>
        ) : (
          <>
            <div className="store-detail-header">
              <div className="store-detail-tier" style={{ background: ts.bg, color: ts.color }}>{store.tier ?? "—"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="store-detail-name">{store.name}</h1>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>{store.chain}</span>
                  <span style={{ fontSize: 12, color: "var(--color-ink-300)", fontWeight: 500 }}>{store.market}</span>
                  {visits.length > 0 && <span style={{ fontSize: 12, color: "var(--color-ink-300)" }}>· Last visited {fmtDate(visits[0].visit_date)}</span>}
                </div>
              </div>
            </div>

            {visits.length === 0 ? (
              <div className="empty-state"><p className="empty-state-icon">🗓</p><p>No visits logged for this store yet.</p></div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)" }}>
                    {galleryMode ? `${allPhotos.length} photo${allPhotos.length !== 1 ? "s" : ""}` : `${visits.length} visit${visits.length !== 1 ? "s" : ""}`}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {hasReview && <button className="gallery-toggle-btn" onClick={() => setShowReport(true)}>📄 Report</button>}
                    {hasPhotos && <button className="gallery-toggle-btn" onClick={() => setGalleryMode(m => !m)}>{galleryMode ? "≡ List" : "⊞ Gallery"}</button>}
                  </div>
                </div>

                {galleryMode ? (
                  <div>
                    {weekGroups.map(g => (
                      <div key={g.key} className="gallery-week">
                        <div className="gallery-week-head">
                          <span className="gallery-week-title">{g.label}</span>
                          <span className="gallery-week-count">{g.photos.length} photo{g.photos.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="photo-gallery-grid">
                          {g.photos.map(fp => {
                            const r = reviews[fp.id];
                            const marks = r?.annotations.length ?? 0;
                            return (
                              <button key={fp.id} className="gallery-cell" onClick={() => setLightboxIdx(allPhotos.indexOf(fp))}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={fp.url} alt="" />
                                {fp.section_key && SECTION_TAG[fp.section_key] && <span className="photo-tag">{SECTION_TAG[fp.section_key]}</span>}
                                {marks > 0 && <span className="photo-marks">⬚ {marks}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    {visits.map(v => {
                      const filledSections = SECTIONS.filter(s => v[s.key as keyof StoreVisit]);
                      return (
                        <div key={v.id} className="visit-card">
                          <div className="visit-card-header" style={{ cursor: "default" }}>
                            <div className="visit-card-store">
                              <p className="visit-store-name">{fmtDate(v.visit_date)}</p>
                              <div className="visit-meta-row">
                                <span className="visit-meta-item">{v.cm_name}</span>
                                {v.photo_count > 0 && <><span className="visit-meta-item">·</span><span className="visit-meta-item">📸 {v.photo_count}</span></>}
                              </div>
                            </div>
                          </div>
                          <div className="visit-detail">
                            {v.photos.length > 0 && (
                              <div className="photo-strip-wrap"><div className="photo-strip">
                                {v.photos.map((ph, i) => (
                                  <button key={ph.id} className="photo-thumb" onClick={() => setLightboxIdx(allPhotos.findIndex(a => a.id === ph.id))}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={ph.url} alt={`Photo ${i + 1}`} />
                                  </button>
                                ))}
                              </div></div>
                            )}
                            {filledSections.length === 0 ? (
                              <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: v.photos.length > 0 ? 8 : 14 }}>No notes were added for this visit.</p>
                            ) : (
                              <div className="visit-sections-grid" style={{ paddingTop: v.photos.length > 0 ? 8 : 14 }}>
                                {filledSections.map(s => (
                                  <div key={s.key} className="visit-section-card">
                                    <div className="visit-section-label" style={{ color: s.color }}>{s.icon} {s.label}</div>
                                    <p className="visit-section-text">{v[s.key as keyof StoreVisit] as string}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Display Review reviewer ── */}
      {active && review && (
        <div className="review-overlay" onClick={closeLb}>
          <button className="lb-nav lb-prev" onClick={e => { e.stopPropagation(); nav(-1); }} aria-label="Previous">‹</button>

          <div className="review-stage" onClick={e => e.stopPropagation()}>
            <div className="review-imgwrap" ref={wrapRef} onMouseDown={onBgDown} style={{ aspectRatio: aspect ?? 1.333 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.url} alt="Photo" className="review-img" draggable={false}
                onLoad={e => { const t = e.currentTarget; if (t.naturalHeight) setAspect(t.naturalWidth / t.naturalHeight); }}
              />
              {review.annotations.map((a, i) => (
                <div
                  key={a.id}
                  className={`ann-box${activeAnn === a.id ? " active" : ""}`}
                  style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}
                  onMouseDown={e => onBoxDown(e, a)}
                  onDoubleClick={e => { e.stopPropagation(); openComposer(a.id, false); }}
                >
                  <div className="ann-num">{i + 1}</div>
                  <div className="ann-handle nw" onMouseDown={e => onHandleDown(e, a, "nw")} />
                  <div className="ann-handle ne" onMouseDown={e => onHandleDown(e, a, "ne")} />
                  <div className="ann-handle sw" onMouseDown={e => onHandleDown(e, a, "sw")} />
                  <div className="ann-handle se" onMouseDown={e => onHandleDown(e, a, "se")} />
                </div>
              ))}
              <div className="review-hint">
                {activeAnn ? "Box selected · ⌫ delete · drag to move · double-click to edit" : "Drag a box around anything that needs fixing"}
              </div>
            </div>
            <div className="lb-context">
              <span className="lb-count">{(lightboxIdx ?? 0) + 1} / {allPhotos.length}</span>
              <span className="lb-meta">{fmtDate(active.visit_date)} · {active.cm_name}{active.section_key && SECTION_TAG[active.section_key] ? ` · ${SECTION_TAG[active.section_key]}` : ""}</span>
            </div>
          </div>

          <div className="review-panel" onClick={e => e.stopPropagation()}>
            <div className="review-panel-head">
              <div className="review-panel-title">Display review</div>
              <div className="review-panel-sub">{review.annotations.length} boxed fix{review.annotations.length !== 1 ? "es" : ""} · {review.comments.length} comment{review.comments.length !== 1 ? "s" : ""}</div>
              <div className="review-grade">
                {[1, 2, 3].map(n => (
                  <button key={n} className={`${GRADES[n].cls}${review.grade === n ? " on" : ""}`} onClick={() => setGrade(n)}>{GRADES[n].label}</button>
                ))}
              </div>
            </div>
            <div className="review-body">
              {review.annotations.length > 0 && <div className="review-sechead">⬚ Boxed fixes</div>}
              {review.annotations.map((a, i) => (
                <div key={a.id} className="review-note" onClick={() => { setActiveAnn(a.id); openComposer(a.id, false); }}>
                  <div className="review-note-num">{i + 1}</div>
                  <div className="review-note-txt">{a.note || <em style={{ color: "var(--color-ink-300)" }}>No note yet</em>}</div>
                </div>
              ))}
              {review.comments.length > 0 && <div className="review-sechead">💬 Comments</div>}
              {review.comments.map(c => (
                <div key={c.id} className="review-note">
                  <div className="review-note-num cmt">•</div>
                  <div className="review-note-txt">{c.body}<small>{c.author_name ?? "Reviewer"}</small></div>
                  <button className="review-note-del" onClick={() => deleteComment(c.id)} aria-label="Delete">✕</button>
                </div>
              ))}
              {review.annotations.length === 0 && review.comments.length === 0 && (
                <div className="review-tip"><b>How this works</b>Drag a box over any spot that needs fixing, then type what to fix. Resize from the corners. Add general notes below.</div>
              )}
            </div>
            <div className="review-addcomment">
              <input value={commentInput} onChange={e => setCommentInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addComment(); }} placeholder="Add a general comment…" />
              <button onClick={addComment}>Add</button>
            </div>
          </div>

          <button className="lb-nav lb-next" onClick={e => { e.stopPropagation(); nav(1); }} aria-label="Next">›</button>
          <button className="lightbox-close" onClick={closeLb}>Close</button>
        </div>
      )}

      {showReport && store && (
        <div className="report-overlay" onClick={() => setShowReport(false)}>
          <div className="report-doc" onClick={e => e.stopPropagation()}>
            <div className="report-head">
              <div>
                <h3>Display Feedback — {store.name}</h3>
                <div className="report-meta">{store.chain} · {store.market} · generated {fmtDate(new Date().toISOString())}</div>
              </div>
              <div className="report-actions">
                <button onClick={copyReportText}>Copy as text</button>
                <button onClick={() => setShowReport(false)}>Close</button>
              </div>
            </div>
            {buildReport().map(wk => (
              <div key={wk.label} className="report-week">
                <div className="report-week-label">{wk.label}</div>
                {wk.photos.map(p => (
                  <div key={p.fp.id} className="report-item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.fp.url} alt="" className="report-thumb" />
                    <div className="report-fix">
                      <div className="report-fix-head">
                        {p.fp.section_key && SECTION_TAG[p.fp.section_key] ? SECTION_TAG[p.fp.section_key] : "Photo"} · {fmtDate(p.fp.visit_date)} · {p.fp.cm_name}
                        {p.grade && <span className={`report-grade ${GRADES[p.grade].cls}`}>{GRADES[p.grade].label}</span>}
                      </div>
                      {p.fixes.map((f, i) => <div key={f.id} className="report-line"><b>{i + 1}.</b> {f.note}</div>)}
                      {p.comments.map(c => <div key={c.id} className="report-line report-cmt">• {c.body}</div>)}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {composer && (
        <div className="ann-composer" style={{ left: composer.left, top: composer.top }} onClick={e => e.stopPropagation()}>
          <div className="ann-composer-head">⬚ Mark a fix</div>
          <textarea
            autoFocus value={composer.text}
            onChange={e => setComposer(c => c ? { ...c, text: e.target.value } : c)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composerSave(); }
              if (e.key === "Escape") { e.preventDefault(); composerCancel(); }
            }}
            placeholder="What should the CM fix in this area?"
          />
          <div className="ann-composer-btns">
            {!composer.isNew && <button className="del" onClick={() => deleteAnn(composer.id)}>Delete</button>}
            <button className="cancel" onClick={composerCancel}>Cancel</button>
            <button className="save" onClick={composerSave}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
