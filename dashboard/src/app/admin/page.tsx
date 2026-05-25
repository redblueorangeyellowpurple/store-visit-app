"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";

type Role = "cm" | "cmic" | "am" | "admin";
type Market = "SG" | "MY" | "TH" | "HK";

interface ActivePerson {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: Role;
  market: Market;
  am_telegram_id: number | null;
  am_name: string | null;
  is_active: boolean;
  is_intelligence_recipient: boolean;
  is_join_request_admin: boolean;
}

interface PendingPerson {
  telegram_id: number;
  full_name: string;
  pending_request_at: string;
}

interface User { first_name: string; username?: string; role?: string }

const ROLES: Role[] = ["cm", "cmic", "am", "admin"];
const MARKETS: Market[] = ["SG", "MY", "HK", "TH"];

const ROLE_LABEL: Record<Role, string> = {
  cm: "CM",
  cmic: "CM IC",
  am: "AM",
  admin: "Admin",
};

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<ActivePerson[]>([]);
  const [pending, setPending] = useState<PendingPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    telegram_id: "",
    full_name: "",
    role: "cm" as Role,
    market: "SG" as Market,
  });
  const [addSubmitting, setAddSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setUser(d); });
    reload();
  }, []);

  async function reload() {
    setLoading(true);
    const res = await fetch("/api/admin/people");
    if (res.ok) {
      const d = await res.json();
      setActive(d.active);
      setPending(d.pending);
    } else {
      setError("Failed to load people");
    }
    setLoading(false);
  }

  // ── pending ───────────────────────────────────────────────────────────────

  async function approve(telegramId: number, market: Market) {
    setSavingKey(`p:${telegramId}`);
    setError(null);
    const res = await fetch("/api/admin/people/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: telegramId, market }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "Approve failed");
    } else {
      await reload();
    }
    setSavingKey(null);
  }

  async function reject(telegramId: number) {
    setSavingKey(`p:${telegramId}`);
    setError(null);
    const res = await fetch("/api/admin/people/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: telegramId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "Reject failed");
    } else {
      setPending((p) => p.filter((x) => x.telegram_id !== telegramId));
    }
    setSavingKey(null);
  }

  // ── add ───────────────────────────────────────────────────────────────────

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const tid = Number(addForm.telegram_id);
    if (!Number.isInteger(tid) || tid <= 0) {
      setError("Telegram ID must be a positive integer");
      return;
    }
    if (!addForm.full_name.trim()) {
      setError("Full name required");
      return;
    }
    setAddSubmitting(true);
    const res = await fetch("/api/admin/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id: tid,
        full_name: addForm.full_name.trim(),
        role: addForm.role,
        market: addForm.market,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "Add failed");
    } else {
      setAddForm({ telegram_id: "", full_name: "", role: "cm", market: "SG" });
      await reload();
    }
    setAddSubmitting(false);
  }

  // ── update (optimistic with rollback) ─────────────────────────────────────

  async function patchPerson(telegramId: number, patch: Record<string, unknown>) {
    setError(null);
    const prev = active;
    setSavingKey(`a:${telegramId}`);
    setActive((rows) => rows.map((r) => (r.telegram_id === telegramId ? { ...r, ...patch } : r)));
    const res = await fetch("/api/admin/people", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: telegramId, ...patch }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "Update failed");
      setActive(prev);
    } else if (patch.is_active === false) {
      // Deactivated rows drop from the active list
      setActive((rows) => rows.filter((r) => r.telegram_id !== telegramId));
    }
    setSavingKey(null);
  }

  // ── AM picker options (active AMs in the same market as the row) ──────────

  const amOptionsByMarket = useMemo(() => {
    const m = new Map<Market, { id: number; name: string }[]>();
    for (const p of active) {
      if (p.role === "am") {
        const arr = m.get(p.market) ?? [];
        arr.push({ id: p.telegram_id, name: p.full_name });
        m.set(p.market, arr);
      }
    }
    return m;
  }, [active]);

  if (!user) return null;

  return (
    <>
      <NavBar user={user} />
      <div className="page-content">
        <header className="admin-header">
          <h1 className="admin-title">Admin</h1>
          <p className="admin-sub">Manage people, stores, and alert routing</p>
        </header>

        {error && <div className="admin-error">{error}</div>}

        {/* ── Pending join requests ─────────────────────────────────────── */}
        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Pending requests</h2>
            <span className="admin-count">{pending.length}</span>
          </div>
          {pending.length === 0 ? (
            <p className="admin-empty">No pending join requests.</p>
          ) : (
            <ul className="admin-pending-list">
              {pending.map((p) => (
                <li key={p.telegram_id} className="admin-pending-row">
                  <div className="admin-pending-info">
                    <span className="admin-pending-name">{p.full_name}</span>
                    <span className="admin-pending-meta">
                      ID {p.telegram_id} · {fmtRelative(p.pending_request_at)}
                    </span>
                  </div>
                  <div className="admin-pending-actions">
                    {MARKETS.map((m) => (
                      <button
                        key={m}
                        className="admin-mini-btn"
                        disabled={savingKey === `p:${p.telegram_id}`}
                        onClick={() => approve(p.telegram_id, m)}
                      >
                        {m}
                      </button>
                    ))}
                    <button
                      className="admin-mini-btn admin-mini-btn--reject"
                      disabled={savingKey === `p:${p.telegram_id}`}
                      onClick={() => reject(p.telegram_id)}
                    >
                      ✗
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Manual add ─────────────────────────────────────────────────── */}
        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Add person manually</h2>
          </div>
          <form className="admin-add-form" onSubmit={submitAdd}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Telegram ID"
              value={addForm.telegram_id}
              onChange={(e) => setAddForm((f) => ({ ...f, telegram_id: e.target.value }))}
              required
            />
            <input
              type="text"
              placeholder="Full name"
              value={addForm.full_name}
              onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
            <select
              value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
            </select>
            <select
              value={addForm.market}
              onChange={(e) => setAddForm((f) => ({ ...f, market: e.target.value as Market }))}
            >
              {MARKETS.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
            <button type="submit" disabled={addSubmitting}>
              {addSubmitting ? "Adding…" : "Add"}
            </button>
          </form>
        </section>

        {/* ── Active people ──────────────────────────────────────────────── */}
        <section className="admin-card">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Active people</h2>
            <span className="admin-count">{active.length}</span>
          </div>
          {loading ? (
            <p className="admin-empty">Loading…</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Market</th>
                    <th>AM</th>
                    <th>
                      <span title="Telegram DM for daily intelligence brief">Intel brief</span>
                    </th>
                    <th>
                      <span title="Telegram DM when a new join request arrives">Join req DM</span>
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => {
                    const amOptions = amOptionsByMarket.get(p.market) ?? [];
                    const saving = savingKey === `a:${p.telegram_id}`;
                    return (
                      <tr key={p.telegram_id} className={saving ? "saving" : undefined}>
                        <td>
                          <div className="admin-name-line">{p.full_name}</div>
                          <div className="admin-name-id">ID {p.telegram_id}</div>
                        </td>
                        <td>
                          <select
                            value={p.role}
                            disabled={saving}
                            onChange={(e) => patchPerson(p.telegram_id, { role: e.target.value })}
                          >
                            {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={p.market}
                            disabled={saving}
                            onChange={(e) => patchPerson(p.telegram_id, { market: e.target.value })}
                          >
                            {MARKETS.map((m) => (<option key={m} value={m}>{m}</option>))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={p.am_telegram_id ?? ""}
                            disabled={saving}
                            onChange={(e) => {
                              const v = e.target.value;
                              patchPerson(p.telegram_id, { am_telegram_id: v === "" ? null : Number(v) });
                            }}
                          >
                            <option value="">— none —</option>
                            {amOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="admin-toggle-cell">
                          <label className="admin-switch">
                            <input
                              type="checkbox"
                              checked={p.is_intelligence_recipient}
                              disabled={saving}
                              onChange={(e) => patchPerson(p.telegram_id, { is_intelligence_recipient: e.target.checked })}
                            />
                            <span className="admin-switch-slider" />
                          </label>
                        </td>
                        <td className="admin-toggle-cell">
                          <label className="admin-switch">
                            <input
                              type="checkbox"
                              checked={p.is_join_request_admin}
                              disabled={saving}
                              onChange={(e) => patchPerson(p.telegram_id, { is_join_request_admin: e.target.checked })}
                            />
                            <span className="admin-switch-slider" />
                          </label>
                        </td>
                        <td>
                          <button
                            className="admin-mini-btn admin-mini-btn--reject"
                            disabled={saving}
                            onClick={() => {
                              if (confirm(`Deactivate ${p.full_name}?`)) {
                                patchPerson(p.telegram_id, { is_active: false });
                              }
                            }}
                          >
                            Deactivate
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="admin-footnote">
          <strong>Intel brief</strong> = receives the daily intelligence digest via Telegram DM.
          <strong> Join req DM</strong> = receives a Telegram DM when a new join request arrives.
          Both are intentionally separate from the role above — admins manage who-can-edit,
          these toggles control who-gets-notified.
        </p>
      </div>
    </>
  );
}
