"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type Market = "ALL" | "SG" | "MY" | "TH" | "HK";

interface VisitRow {
  id: string;
  visit_date: string;
  cm_name: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  photo_count: number;
  photo_urls: string[];
  edited_at: string | null;
  training_count: number;
  follow_up_count: number;
}

interface CMOption { telegram_id: number; name: string }
interface User { first_name: string; username?: string }

const MARKET_OPTIONS: { value: Market; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SG",  label: "🇸🇬 SG" },
  { value: "MY",  label: "🇲🇾 MY" },
  { value: "TH",  label: "🇹🇭 TH" },
  { value: "HK",  label: "🇭🇰 HK" },
];

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

type SectionKey = typeof SECTIONS[number]["key"];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function toISO(d: Date): string { return d.toISOString().slice(0, 10); }

function weekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmtDay(monday)} – ${fmtDay(sunday)} ${monday.getFullYear()}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function VisitsPage() {
  const [user,       setUser]       = useState<User | null>(null);
  const [visits,     setVisits]     = useState<VisitRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [cms,        setCms]        = useState<CMOption[]>([]);
  const [market,     setMarket]     = useState<Market>("ALL");
  const [filterCM,   setFilterCM]   = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [lightbox,   setLightbox]   = useState<string | null>(null);
  const [focusSection, setFocusSection] = useState<SectionKey | null>(null);

  function toggleFocus(key: SectionKey) {
    setFocusSection(curr => curr === key ? null : key);
  }

  const thisMonday    = getMonday(new Date());
  const currentMonday = addWeeks(thisMonday, weekOffset);
  const currentSunday = new Date(currentMonday);
  currentSunday.setDate(currentMonday.getDate() + 6);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/filters").then(r => r.ok ? r.json() : null).then(d => { if (d) setCms(d.cms); });
  }, []);

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set("from", toISO(currentMonday));
    p.set("to",   toISO(currentSunday));
    if (market !== "ALL") p.set("market", market);
    if (filterCM) p.set("cm", filterCM);
    const res = await fetch(`/api/visits?${p}`);
    if (res.ok) {
      const data = await res.json();
      setVisits(data.visits);
      setTotal(data.total);
    }
    setLoading(false);
  }, [market, filterCM, weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  if (!user) return null;

  const isCurrentWeek = weekOffset === 0;
  const isFutureWeek  = weekOffset > 0;

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content">

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <h1 className="section-title" style={{ fontSize: 20, marginBottom: 4 }}>Store Updates</h1>
          <p style={{ fontSize: 13, color: "var(--color-ink-300)" }}>
            {loading ? "Loading…" : `${total} visit${total !== 1 ? "s" : ""} this week`}
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div className="market-chips">
            {MARKET_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                className={`mchip${market === value ? " active" : ""}`}
                onClick={() => setMarket(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div className="week-nav">
            <button className="week-btn" onClick={() => setWeekOffset(w => w - 1)}>‹</button>
            <span className="week-label">{isCurrentWeek ? "This week" : weekLabel(currentMonday)}</span>
            <button className="week-btn" disabled={isFutureWeek} onClick={() => setWeekOffset(w => w + 1)}>›</button>
          </div>
          {cms.length > 0 && (
            <select value={filterCM} onChange={e => setFilterCM(e.target.value)} className="filter-select">
              <option value="">All CMs</option>
              {cms.map(c => <option key={c.telegram_id} value={c.telegram_id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {/* Section focus chips — pick one to filter & narrow view to that section */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-300)", textTransform: "uppercase", letterSpacing: "0.6px", marginRight: 4 }}>
            Show
          </span>
          <button
            onClick={() => setFocusSection(null)}
            className="mchip"
            style={{
              background: focusSection === null ? "var(--color-tc-50)" : undefined,
              color: focusSection === null ? "var(--color-tc-600)" : undefined,
              borderColor: focusSection === null ? "var(--color-tc-100)" : undefined,
            }}
          >
            All
          </button>
          {SECTIONS.map(s => {
            const active = focusSection === s.key;
            return (
              <button
                key={s.key}
                onClick={() => toggleFocus(s.key)}
                className="mchip"
                style={{
                  background: active ? "var(--color-tc-50)" : undefined,
                  color: active ? "var(--color-tc-600)" : undefined,
                  borderColor: active ? "var(--color-tc-100)" : undefined,
                }}
              >
                {s.icon} {s.label}
              </button>
            );
          })}
        </div>

        {/* Feed */}
        {loading ? (
          <div className="empty-state">
            <p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p>
          </div>
        ) : (() => {
          const filtered = focusSection === null
            ? visits
            : visits.filter(v => v[focusSection]);
          if (filtered.length === 0) {
            const focusLabel = focusSection ? SECTIONS.find(s => s.key === focusSection)?.label : null;
            return (
              <div className="empty-state">
                <p className="empty-state-icon">📋</p>
                <p>
                  {visits.length === 0
                    ? <>No visits logged for this week{market !== "ALL" ? ` in ${market}` : ""}.</>
                    : <>No visits with {focusLabel} for this week.</>}
                </p>
              </div>
            );
          }
          return (
          <div className="visit-card-grid">
            {filtered.map(v => {
              const tier = v.store_tier;
              const ts   = tier ? TIER_STYLE[tier] : null;
              const visibleSections = focusSection === null
                ? SECTIONS.filter(s => v[s.key])
                : SECTIONS.filter(s => s.key === focusSection && v[s.key]);

              return (
                <div key={v.id} className="visit-card">
                  {/* Header */}
                  <div className="visit-card-header" style={{ cursor: "default" }}>
                    {ts && (
                      <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>{tier}</span>
                    )}
                    <div className="visit-card-store">
                      <Link
                        href={`/visits/store/${v.store_id}`}
                        className="visit-store-name visit-store-link"
                      >
                        {v.store_name}
                      </Link>
                      <div className="visit-meta-row">
                        <span className="visit-meta-item">{v.cm_name}</span>
                        <span className="visit-meta-item">·</span>
                        <span className="visit-meta-item">{fmtDate(v.visit_date)}</span>
                        {v.photo_count > 0 && (
                          <>
                            <span className="visit-meta-item">·</span>
                            <span className="visit-meta-item">📸 {v.photo_count}</span>
                          </>
                        )}
                        {v.training_count > 0 && (
                          <>
                            <span className="visit-meta-item">·</span>
                            <span className="visit-meta-item">🎓 {v.training_count} trained</span>
                          </>
                        )}
                        {v.follow_up_count > 0 && (
                          <>
                            <span className="visit-meta-item">·</span>
                            <span className="visit-meta-item">📌 {v.follow_up_count} follow-up{v.follow_up_count !== 1 ? "s" : ""}</span>
                          </>
                        )}
                        {v.edited_at && (
                          <>
                            <span className="visit-meta-item">·</span>
                            <span className="visit-meta-item" style={{ color: "var(--color-ink-300)" }}>edited</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Always-visible body */}
                  <div className="visit-detail">
                    {/* Photo strip */}
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

                    {/* Section cards */}
                    {visibleSections.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: v.photo_urls.length > 0 ? 8 : 14 }}>
                        No notes were added for this visit.
                      </p>
                    ) : (
                      <div className="visit-sections-grid" style={{ paddingTop: v.photo_urls.length > 0 ? 8 : 14 }}>
                        {visibleSections.map(s => (
                          <div
                            key={s.key}
                            className="visit-section-card"
                            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
                          >
                            <div className="visit-section-label" style={{ color: s.color, gap: 6 }}>
                              <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 20,
                                height: 20,
                                borderRadius: 6,
                                background: s.iconBg,
                                fontSize: 11,
                              }}>{s.icon}</span>
                              <span>{s.label}</span>
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
          );
        })()}
      </div>

      {/* Lightbox */}
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
