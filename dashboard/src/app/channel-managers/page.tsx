"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import NavBar from "@/components/NavBar";
import RefreshControl from "@/components/RefreshControl";

type Market = "ALL" | "SG" | "MY" | "TH" | "HK";
type Role = "cm" | "cmic" | "am" | "admin";

interface AssignedStore {
  id: string;
  name: string;
  chain: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
  market: "SG" | "MY" | "TH" | "HK";
}

interface CM {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: Role;
  market: "SG" | "MY" | "TH" | "HK";
  am_telegram_id: number | null;
  am_name: string | null;
  assigned_stores: AssignedStore[];
}

interface StoreOption {
  id: string;
  name: string;
  chain: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
  market: "SG" | "MY" | "TH" | "HK";
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

const MARKET_PILL: Record<string, { bg: string; color: string }> = {
  SG: { bg: "#FBE6E2", color: "#B5331A" },
  MY: { bg: "#DDE9FB", color: "#1A5DB5" },
  HK: { bg: "#D6F0DC", color: "#1E7A3A" },
  TH: { bg: "#EDE8FD", color: "#5B3FB5" },
};

const ROLE_LABEL: Record<Role, string> = {
  cm: "CM",
  cmic: "CM IC",
  am: "AM",
  admin: "Admin",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ChannelManagersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [cms, setCms] = useState<CM[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<Market>("ALL");
  const [query, setQuery] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/cms")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setCms(d.cms); setStores(d.stores); } })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cms.filter(c => {
      if (market !== "ALL" && c.market !== market) return false;
      if (q && !c.full_name.toLowerCase().includes(q) && !(c.am_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cms, market, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CM[]>();
    for (const c of filtered) {
      const key = c.am_name ?? "Unassigned (no AM)";
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0].startsWith("Unassigned")) return 1;
      if (b[0].startsWith("Unassigned")) return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const summary = useMemo(() => ({
    total: cms.length,
    assigned: cms.reduce((s, c) => s + c.assigned_stores.length, 0),
    unassigned: cms.filter(c => c.assigned_stores.length === 0 && (c.role === "cm" || c.role === "cmic")).length,
  }), [cms]);

  const silentRefresh = useCallback(async () => {
    const res = await fetch("/api/cms");
    if (res.ok) {
      const d = await res.json();
      if (d) { setCms(d.cms); setStores(d.stores); }
    }
  }, []);

  const refresh = useAutoRefresh(silentRefresh, { intervalMs: 60_000, paused: savingKey !== null });

  async function assign(cmId: number, storeId: string) {
    const key = `${cmId}:${storeId}`;
    setSavingKey(key);
    setError(null);
    const store = stores.find(s => s.id === storeId);
    if (!store) { setSavingKey(null); return; }
    const optimistic = cms.map(c => c.telegram_id === cmId
      ? { ...c, assigned_stores: [...c.assigned_stores, store].sort((a, b) =>
          a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name)) }
      : c);
    setCms(optimistic);
    const res = await fetch("/api/cms/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cm_telegram_id: cmId, store_id: storeId }),
    });
    if (!res.ok) {
      setError("Failed to assign store");
      setCms(cms);
    }
    setSavingKey(null);
  }

  async function unassign(cmId: number, storeId: string) {
    const key = `${cmId}:${storeId}`;
    setSavingKey(key);
    setError(null);
    const prev = cms;
    const optimistic = cms.map(c => c.telegram_id === cmId
      ? { ...c, assigned_stores: c.assigned_stores.filter(s => s.id !== storeId) }
      : c);
    setCms(optimistic);
    const res = await fetch("/api/cms/assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cm_telegram_id: cmId, store_id: storeId }),
    });
    if (!res.ok) {
      setError("Failed to unassign store");
      setCms(prev);
    }
    setSavingKey(null);
  }

  if (!user) return null;

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content">

        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 className="section-title" style={{ fontSize: 20, marginBottom: 4 }}>Channel Managers</h1>
            <p style={{ fontSize: 13, color: "var(--color-ink-300)" }}>
              {loading
                ? "Loading…"
                : `${filtered.length} of ${summary.total} CMs · ${summary.assigned} store assignments · ${summary.unassigned} without stores`}
            </p>
          </div>
          <RefreshControl controls={refresh} />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
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
            placeholder="Search CM or AM…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="staff-search"
          />
        </div>

        {error && (
          <div style={{
            background: "#FBE6E2", color: "#B5331A", border: "1px solid #F5BDA5",
            borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="empty-state"><p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-icon">👥</p>
            <p>No CMs match these filters.</p>
          </div>
        ) : (
          grouped.map(([amName, members]) => (
            <Fragment key={amName}>
              <div className="cm-group-header">
                <span className="cm-group-name">{amName}</span>
                <span className="cm-group-count">{members.length} CM{members.length === 1 ? "" : "s"}</span>
              </div>
              <div className="staff-store-grid" style={{ marginBottom: 20 }}>
                {members.map(c => {
                  const pill = MARKET_PILL[c.market];
                  const assignedIds = new Set(c.assigned_stores.map(s => s.id));
                  const pickable = stores
                    .filter(s => !assignedIds.has(s.id))
                    .filter(s => s.market === c.market)
                    .sort((a, b) => a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name));
                  return (
                    <div key={c.telegram_id} className="staff-store-card">
                      <div className="staff-store-header">
                        <div className="staff-store-titleline" style={{ gap: 10 }}>
                          <div className="staff-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                            {initials(c.nickname ?? c.full_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="staff-store-name">{c.full_name}</div>
                            <div className="staff-store-meta" style={{ marginTop: 2 }}>
                              {ROLE_LABEL[c.role]}
                              {c.nickname && c.nickname !== c.full_name ? ` · "${c.nickname}"` : ""}
                            </div>
                          </div>
                        </div>
                        <span className="market-pill" style={{ background: pill.bg, color: pill.color }}>
                          {c.market}
                        </span>
                      </div>

                      <div className="staff-rows">
                        {c.assigned_stores.length === 0 ? (
                          <div className="cm-empty">No stores assigned yet</div>
                        ) : (
                          c.assigned_stores.map(s => {
                            const ts = s.tier ? TIER_STYLE[s.tier] : null;
                            const isSaving = savingKey === `${c.telegram_id}:${s.id}`;
                            return (
                              <div key={s.id} className="staff-row" style={{ padding: "10px 16px" }}>
                                <div className="staff-body">
                                  <div className="staff-name-line">
                                    {ts && (
                                      <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>
                                        {s.tier}
                                      </span>
                                    )}
                                    <span className="staff-name">{s.name}</span>
                                  </div>
                                  <div className="staff-meta">{s.chain}</div>
                                </div>
                                <button
                                  className="ally-toggle"
                                  disabled={isSaving}
                                  onClick={() => unassign(c.telegram_id, s.id)}
                                  title="Unassign store"
                                  style={{ minWidth: 32, padding: "6px 10px" }}
                                >
                                  {isSaving ? "…" : "×"}
                                </button>
                              </div>
                            );
                          })
                        )}

                        <div className="cm-add-row">
                          <select
                            className="cm-add-select"
                            value=""
                            disabled={pickable.length === 0 || savingKey?.startsWith(`${c.telegram_id}:`) === true}
                            onChange={(e) => {
                              const sid = e.target.value;
                              if (sid) assign(c.telegram_id, sid);
                              e.target.value = "";
                            }}
                          >
                            <option value="">
                              {pickable.length === 0
                                ? `All ${c.market} stores assigned`
                                : `+ Add store… (${pickable.length} available)`}
                            </option>
                            {pickable.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.tier ? `[${s.tier}] ` : ""}{s.chain} · {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Fragment>
          ))
        )}

      </div>
    </div>
  );
}
