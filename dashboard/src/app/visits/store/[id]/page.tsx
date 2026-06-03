"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
}

interface PhotoItem {
  id: string;
  url: string;
  section_key: string | null;
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

// A photo flattened across visits, carrying the context the lightbox/gallery needs.
interface FlatPhoto extends PhotoItem {
  visit_id: string;
  visit_date: string;
  cm_name: string;
}

interface User { first_name: string; username?: string }

const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

const SECTIONS = [
  { key: "good_news",     label: "Good News",             icon: "🌟", iconBg: "var(--color-section-amber-bg)",  color: "var(--color-tc-600)" },
  { key: "competitors",   label: "Competitors' Insights", icon: "🔍", iconBg: "var(--color-section-blue-bg)",   color: "var(--color-tier-t1-fg)" },
  { key: "display_stock", label: "Display & Stock",       icon: "📦", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_up",     label: "What to Follow Up",     icon: "✅", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
  { key: "buzz_plan",     label: "Buzz Plan",             icon: "⚡", iconBg: "var(--color-section-purple-bg)", color: "#5B2DB5" },
] as const;

// Photo section badge labels (visit_photos.section_key values).
const SECTION_TAG: Record<string, string> = {
  display_stock: "Display",
  competitor: "Competitor",
  good_news: "Good News",
  people_training: "Training",
  follow_up: "Follow-up",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function mondayOf(iso: string): Date {
  const d = new Date(iso + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

function weekLabel(mon: Date): string {
  const end = new Date(mon); end.setDate(mon.getDate() + 6);
  const day = (x: Date) => x.getDate();
  const mo  = (x: Date) => x.toLocaleDateString("en-GB", { month: "short" });
  const sameMonth = mon.getMonth() === end.getMonth();
  return sameMonth
    ? `${day(mon)}–${day(end)} ${mo(end)} ${end.getFullYear()}`
    : `${day(mon)} ${mo(mon)} – ${day(end)} ${mo(end)} ${end.getFullYear()}`;
}

export default function StoreDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [user,        setUser]        = useState<User | null>(null);
  const [store,       setStore]       = useState<StoreInfo | null>(null);
  const [visits,      setVisits]      = useState<StoreVisit[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [galleryMode, setGalleryMode] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/visits/store/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) { setStore(d.store); setVisits(d.visits); }
        setLoading(false);
      });
  }, [id]);

  // Flat, newest-first photo list — drives both the gallery and the lightbox.
  const allPhotos: FlatPhoto[] = visits.flatMap(v =>
    v.photos.map(p => ({ ...p, visit_id: v.id, visit_date: v.visit_date, cm_name: v.cm_name })),
  );

  const closeLb = useCallback(() => setLightboxIdx(null), []);
  const nav = useCallback((delta: number) => {
    setLightboxIdx(i => (i === null ? i : (i + delta + allPhotos.length) % allPhotos.length));
  }, [allPhotos.length]);

  // Keyboard nav — must stay above the `if (!user)` early return (React hook-order rule).
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
      else if (e.key === "Escape") closeLb();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, nav, closeLb]);

  if (!user) return null;

  const tier = store?.tier ?? null;
  const ts   = tier ? TIER_STYLE[tier] : TIER_STYLE.T4;
  const hasPhotos = allPhotos.length > 0;

  // Group the flat photo list by ISO week (newest week first).
  const weekGroups: { key: string; label: string; photos: FlatPhoto[] }[] = [];
  const weekIdx = new Map<string, number>();
  for (const fp of allPhotos) {
    const mon = mondayOf(fp.visit_date);
    const key = isoDate(mon);
    let gi = weekIdx.get(key);
    if (gi === undefined) { gi = weekGroups.length; weekIdx.set(key, gi); weekGroups.push({ key, label: weekLabel(mon), photos: [] }); }
    weekGroups[gi].photos.push(fp);
  }

  const active = lightboxIdx !== null ? allPhotos[lightboxIdx] : null;

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content" style={{ maxWidth: 900 }}>

        <Link
          href="/visits"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--color-ink-400)", fontWeight: 600, marginBottom: 20, textDecoration: "none" }}
        >
          ‹ Store Updates
        </Link>

        {loading ? (
          <div className="empty-state">
            <p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p>
          </div>
        ) : !store ? (
          <div className="empty-state">
            <p className="empty-state-icon">🏪</p>
            <p>Store not found.</p>
          </div>
        ) : (
          <>
            {/* Store header */}
            <div className="store-detail-header">
              <div className="store-detail-tier" style={{ background: ts.bg, color: ts.color }}>
                {store.tier ?? "—"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="store-detail-name">{store.name}</h1>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>{store.chain}</span>
                  <span style={{ fontSize: 12, color: "var(--color-ink-300)", fontWeight: 500 }}>{store.market}</span>
                  {visits.length > 0 && (
                    <span style={{ fontSize: 12, color: "var(--color-ink-300)" }}>
                      · Last visited {fmtDate(visits[0].visit_date)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {visits.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-icon">🗓</p>
                <p>No visits logged for this store yet.</p>
              </div>
            ) : (
              <>
                {/* Section header + gallery toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-ink-300)" }}>
                    {galleryMode
                      ? `${allPhotos.length} photo${allPhotos.length !== 1 ? "s" : ""}`
                      : `${visits.length} visit${visits.length !== 1 ? "s" : ""}`}
                  </span>
                  {hasPhotos && (
                    <button className="gallery-toggle-btn" onClick={() => setGalleryMode(m => !m)}>
                      {galleryMode ? "≡ List" : "⊞ Gallery"}
                    </button>
                  )}
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
                          {g.photos.map(fp => (
                            <button key={fp.id} className="gallery-cell" onClick={() => setLightboxIdx(allPhotos.indexOf(fp))}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={fp.url} alt="" />
                              {fp.section_key && SECTION_TAG[fp.section_key] && (
                                <span className="photo-tag">{SECTION_TAG[fp.section_key]}</span>
                              )}
                            </button>
                          ))}
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
                          {/* Header */}
                          <div className="visit-card-header" style={{ cursor: "default" }}>
                            <div className="visit-card-store">
                              <p className="visit-store-name">{fmtDate(v.visit_date)}</p>
                              <div className="visit-meta-row">
                                <span className="visit-meta-item">{v.cm_name}</span>
                                {v.photo_count > 0 && (
                                  <>
                                    <span className="visit-meta-item">·</span>
                                    <span className="visit-meta-item">📸 {v.photo_count}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Always-visible body */}
                          <div className="visit-detail">
                            {v.photos.length > 0 && (
                              <div className="photo-strip-wrap">
                                <div className="photo-strip">
                                  {v.photos.map((ph, i) => (
                                    <button key={ph.id} className="photo-thumb" onClick={() => setLightboxIdx(allPhotos.findIndex(a => a.id === ph.id))}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={ph.url} alt={`Photo ${i + 1}`} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {filledSections.length === 0 ? (
                              <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: v.photos.length > 0 ? 8 : 14 }}>
                                No notes were added for this visit.
                              </p>
                            ) : (
                              <div className="visit-sections-grid" style={{ paddingTop: v.photos.length > 0 ? 8 : 14 }}>
                                {filledSections.map(s => (
                                  <div key={s.key} className="visit-section-card">
                                    <div className="visit-section-label" style={{ color: s.color }}>
                                      {s.icon} {s.label}
                                    </div>
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

      {active && (
        <div className="lightbox-overlay" onClick={closeLb}>
          <button className="lb-nav lb-prev" onClick={e => { e.stopPropagation(); nav(-1); }} aria-label="Previous">‹</button>
          <div className="lb-stage" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt="Photo" className="lightbox-img" />
            <div className="lb-context">
              <span className="lb-count">{(lightboxIdx ?? 0) + 1} / {allPhotos.length}</span>
              <span className="lb-meta">
                {fmtDate(active.visit_date)} · {active.cm_name}
                {active.section_key && SECTION_TAG[active.section_key] ? ` · ${SECTION_TAG[active.section_key]}` : ""}
              </span>
            </div>
          </div>
          <button className="lb-nav lb-next" onClick={e => { e.stopPropagation(); nav(1); }} aria-label="Next">›</button>
          <button className="lightbox-close" onClick={closeLb}>Close</button>
        </div>
      )}
    </div>
  );
}
