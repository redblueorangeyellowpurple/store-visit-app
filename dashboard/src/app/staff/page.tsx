"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import NavBar from "@/components/NavBar";
import RefreshControl from "@/components/RefreshControl";

type Market = "ALL" | "SG" | "MY" | "TH" | "HK";

interface StaffRow {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  is_ally: boolean;
  ally_since: string | null;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  store_market: "SG" | "MY" | "TH" | "HK";
  tagged_visits: number;
  times_trained: number;
  last_trained_at: string | null;
  last_trained_products: string | null;
}

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

type Filter = "all" | "allies" | "trained" | "untouched";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function StaffPage() {
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<Market>("ALL");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/staff")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStaff(d.staff); })
      .finally(() => setLoading(false));
  }, []);

  const silentRefresh = useCallback(async () => {
    const res = await fetch("/api/staff");
    if (res.ok) {
      const d = await res.json();
      if (d?.staff) setStaff(d.staff);
    }
  }, []);

  const refresh = useAutoRefresh(silentRefresh, { intervalMs: 60_000, paused: savingId !== null });

  async function toggleAlly(id: string, makeAlly: boolean) {
    setSavingId(id);
    const optimistic = staff.map(s => s.id === id ? { ...s, is_ally: makeAlly, ally_since: makeAlly ? new Date().toISOString() : null } : s);
    setStaff(optimistic);
    const res = await fetch("/api/staff", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_ally: makeAlly }),
    });
    if (!res.ok) {
      // revert on failure
      const revert = staff.map(s => s.id === id ? { ...s } : s);
      setStaff(revert);
    }
    setSavingId(null);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter(s => {
      if (market !== "ALL" && s.store_market !== market) return false;
      if (filter === "allies" && !s.is_ally) return false;
      if (filter === "trained" && (s.times_trained ?? 0) === 0) return false;
      if (filter === "untouched" && (s.tagged_visits ?? 0) > 0) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.store_name.toLowerCase().includes(q) && !(s.store_chain ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [staff, market, filter, query]);

  const groupedByStore = useMemo(() => {
    const map = new Map<string, { storeName: string; chain: string; tier: StaffRow["store_tier"]; market: StaffRow["store_market"]; rows: StaffRow[] }>();
    for (const s of filtered) {
      const key = s.store_id;
      const cur = map.get(key);
      if (cur) {
        cur.rows.push(s);
      } else {
        map.set(key, { storeName: s.store_name, chain: s.store_chain, tier: s.store_tier, market: s.store_market, rows: [s] });
      }
    }
    return [...map.values()].sort((a, b) => {
      const c = a.chain.localeCompare(b.chain);
      if (c !== 0) return c;
      return a.storeName.localeCompare(b.storeName);
    });
  }, [filtered]);

  const summary = useMemo(() => ({
    total: staff.length,
    allies: staff.filter(s => s.is_ally).length,
    trained: staff.filter(s => (s.times_trained ?? 0) > 0).length,
    untouched: staff.filter(s => (s.tagged_visits ?? 0) === 0).length,
  }), [staff]);

  if (!user) return null;

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content">

        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="section-title" style={{ fontSize: 20, marginBottom: 4 }}>Store Staff</h1>
            <p style={{ fontSize: 13, color: "var(--color-ink-300)" }}>
              {loading ? "Loading…" : `${filtered.length} of ${staff.length} staff · ${summary.allies} allies · ${summary.trained} trained`}
            </p>
          </div>
          <RefreshControl controls={refresh} />
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
          <input
            type="search"
            placeholder="Search staff or store…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="staff-search"
          />
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-300)", textTransform: "uppercase", letterSpacing: "0.6px", marginRight: 4 }}>Show</span>
          <button onClick={() => setFilter("all")} className={`mchip${filter === "all" ? " active" : ""}`}>All <span className="chip-count">{summary.total}</span></button>
          <button onClick={() => setFilter("allies")} className={`mchip${filter === "allies" ? " active" : ""}`}>🤝 Allies <span className="chip-count">{summary.allies}</span></button>
          <button onClick={() => setFilter("trained")} className={`mchip${filter === "trained" ? " active" : ""}`}>🎓 Trained <span className="chip-count">{summary.trained}</span></button>
          <button onClick={() => setFilter("untouched")} className={`mchip${filter === "untouched" ? " active" : ""}`}>○ Never tagged <span className="chip-count">{summary.untouched}</span></button>
        </div>

        {loading ? (
          <div className="empty-state"><p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-icon">👥</p>
            <p>No staff match these filters.</p>
          </div>
        ) : (
          <div className="staff-store-grid">
            {groupedByStore.map(g => {
              const ts = g.tier ? TIER_STYLE[g.tier] : null;
              return (
                <div key={g.storeName + g.chain} className="staff-store-card">
                  <div className="staff-store-header">
                    <div className="staff-store-titleline">
                      {ts && (
                        <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>
                          {g.tier}
                        </span>
                      )}
                      <span className="staff-store-name">{g.storeName}</span>
                    </div>
                    <span className="staff-store-meta">{g.chain} · {g.market}</span>
                  </div>
                  <div className="staff-rows">
                    {g.rows.map(s => {
                      const isSaving = savingId === s.id;
                      return (
                        <Fragment key={s.id}>
                          <div className="staff-row">
                            <div className="staff-avatar">{initials(s.name)}</div>
                            <div className="staff-body">
                              <div className="staff-name-line">
                                <span className="staff-name">{s.name}</span>
                                {s.is_ally && <span className="ally-pill">🤝 Ally</span>}
                                {(s.times_trained ?? 0) > 0 && (
                                  <span className="trained-pill">🎓 ×{s.times_trained}</span>
                                )}
                              </div>
                              <div className="staff-meta">
                                {s.role ?? "Staff"}
                                {(s.tagged_visits ?? 0) > 0 && <> · tagged in {s.tagged_visits} visit{s.tagged_visits === 1 ? "" : "s"}</>}
                                {s.last_trained_at && <> · last trained {fmtDate(s.last_trained_at)}</>}
                              </div>
                              {s.last_trained_products && (
                                <div className="staff-products">on: {s.last_trained_products}</div>
                              )}
                            </div>
                            <button
                              className={`ally-toggle${s.is_ally ? " on" : ""}`}
                              disabled={isSaving}
                              onClick={() => toggleAlly(s.id, !s.is_ally)}
                              title={s.is_ally ? "Remove ally status" : "Mark as ally"}
                            >
                              {isSaving ? "…" : s.is_ally ? "Ally" : "Mark ally"}
                            </button>
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
