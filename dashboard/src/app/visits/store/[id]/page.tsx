"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
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

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StoreDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [user,        setUser]        = useState<User | null>(null);
  const [store,       setStore]       = useState<StoreInfo | null>(null);
  const [visits,      setVisits]      = useState<StoreVisit[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [galleryMode, setGalleryMode] = useState(false);
  const [lightbox,    setLightbox]    = useState<string | null>(null);

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

  if (!user) return null;

  const tier = store?.tier ?? null;
  const ts   = tier ? TIER_STYLE[tier] : TIER_STYLE.T4;
  const allPhotos = visits.flatMap(v => v.photo_urls.map(url => ({ url, visitDate: v.visit_date })));
  const hasPhotos = allPhotos.length > 0;

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
                    {visits.length} visit{visits.length !== 1 ? "s" : ""}
                  </span>
                  {hasPhotos && (
                    <button className="gallery-toggle-btn" onClick={() => setGalleryMode(m => !m)}>
                      {galleryMode ? "≡ List" : "⊞ Gallery"}
                    </button>
                  )}
                </div>

                {galleryMode ? (
                  <div className="photo-gallery-grid">
                    {allPhotos.map((p, i) => (
                      <button key={i} className="gallery-cell" onClick={() => setLightbox(p.url)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    {visits.map(v => {
                      const filledSections = SECTIONS.filter(s => v[s.key]);
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
                            {v.photo_urls.length > 0 && (
                              <div className="photo-strip-wrap">
                                <div className="photo-strip">
                                  {v.photo_urls.map((url, i) => (
                                    <button key={i} className="photo-thumb" onClick={() => setLightbox(url)}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={url} alt={`Photo ${i + 1}`} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {filledSections.length === 0 ? (
                              <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: v.photo_urls.length > 0 ? 8 : 14 }}>
                                No notes were added for this visit.
                              </p>
                            ) : (
                              <div className="visit-sections-grid" style={{ paddingTop: v.photo_urls.length > 0 ? 8 : 14 }}>
                                {filledSections.map(s => (
                                  <div key={s.key} className="visit-section-card">
                                    <div className="visit-section-label" style={{ color: s.color }}>
                                      {s.icon} {s.label}
                                    </div>
                                    <p className="visit-section-text">{v[s.key]}</p>
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

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo" className="lightbox-img" />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>Close</button>
        </div>
      )}
    </div>
  );
}
