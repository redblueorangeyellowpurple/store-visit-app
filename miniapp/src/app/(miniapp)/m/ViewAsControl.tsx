"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { initTelegram } from "./telegram-init";

interface Whoami {
  telegram_id: number;
  name: string;
  nickname: string | null;
  role: "cm" | "cmic" | "am" | "admin";
  impersonating: boolean;
  real: { telegram_id: number; name: string } | null;
}

interface ViewAsCM {
  telegram_id: number;
  name: string;
  role: string;
  market: string;
}

const HIDE_KEY = "sva_viewas_hidden";
// Must match the key the root-layout fetch shim reads.
const VIEW_KEY = "sva_view_as";

export default function ViewAsControl() {
  const [initData, setInitData] = useState<string | null>(null);
  const [me, setMe] = useState<Whoami | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cms, setCms] = useState<ViewAsCM[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHidden(localStorage.getItem(HIDE_KEY) === "1");
    (async () => {
      const id = await initTelegram();
      setInitData(id);
      if (!id) return;
      try {
        const res = await fetch("/api/m/whoami", {
          headers: { Authorization: `tma ${id}` },
        });
        if (res.ok) setMe(await res.json());
      } catch {
        /* control just stays hidden on failure */
      }
    })();
  }, []);

  const setHiddenPersist = useCallback((v: boolean) => {
    setHidden(v);
    localStorage.setItem(HIDE_KEY, v ? "1" : "0");
  }, []);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    if (cms || !initData) return;
    try {
      const res = await fetch("/api/m/view-as", {
        headers: { Authorization: `tma ${initData}` },
      });
      if (res.ok) {
        const j = await res.json();
        setCms(j.cms as ViewAsCM[]);
      }
    } catch {
      /* leave list empty; user can close */
    }
  }, [cms, initData]);

  // Entering/exiting view-as is purely client-side: stash (or clear) the target
  // in sessionStorage, then hard-reload so every page refetches as the new
  // identity (the shim adds the X-View-As header from sessionStorage).
  const enter = useCallback(
    (targetId: number) => {
      if (busy) return;
      setBusy(true);
      sessionStorage.setItem(VIEW_KEY, String(targetId));
      window.location.reload();
    },
    [busy],
  );

  const exit = useCallback(() => {
    if (busy) return;
    setBusy(true);
    sessionStorage.removeItem(VIEW_KEY);
    window.location.reload();
  }, [busy]);

  const filtered = useMemo(() => {
    if (!cms) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return cms;
    return cms.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.market.toLowerCase().includes(needle) ||
        c.role.toLowerCase().includes(needle),
    );
  }, [cms, q]);

  // Only real admins ever see this control. When impersonating, whoami.role is
  // the *target's* role, but `impersonating` is true → an admin is behind it.
  if (!me) return null;
  const isAdmin = me.impersonating || me.role === "admin";
  if (!isAdmin) return null;

  // Collapsed to a tiny dot — tap to restore.
  if (hidden) {
    return (
      <button
        onClick={() => setHiddenPersist(false)}
        aria-label="Show view-as control"
        className={`fixed right-3 bottom-[100px] z-[60] h-10 w-10 rounded-full shadow-lg flex items-center justify-center text-lg active:scale-95 transition ${
          me.impersonating
            ? "bg-[var(--color-tc-400)] text-white"
            : "bg-white text-[var(--color-ink-500)] border border-[var(--color-ink-200)]"
        }`}
      >
        👁
      </button>
    );
  }

  return (
    <>
      {me.impersonating ? (
        // ── Active view-as: persistent bar ────────────────────────────────
        <div className="fixed left-3 right-3 bottom-[100px] z-[60] flex items-center gap-2 rounded-2xl bg-[var(--color-tc-400)] text-white px-3.5 py-2.5 shadow-lg">
          <span className="text-base leading-none">👁</span>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[10px] uppercase tracking-wider opacity-80">
              Viewing as
            </div>
            <div className="text-sm font-bold truncate">
              {me.nickname ?? me.name}
            </div>
          </div>
          <button
            onClick={exit}
            disabled={busy}
            className="shrink-0 rounded-full bg-white/95 text-[var(--color-tc-600)] text-xs font-extrabold px-3.5 py-1.5 active:scale-95 transition disabled:opacity-50"
          >
            {busy ? "…" : "Exit"}
          </button>
          <button
            onClick={() => setHiddenPersist(true)}
            aria-label="Hide bar"
            className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-white/90 hover:bg-white/15 text-lg leading-none"
          >
            ×
          </button>
        </div>
      ) : (
        // ── Idle launcher (admin, not viewing as anyone) ──────────────────
        <div className="fixed right-3 bottom-[100px] z-[60] flex items-center gap-1.5 rounded-full bg-white border border-[var(--color-ink-200)] shadow-lg pl-3.5 pr-1.5 py-1.5">
          <button
            onClick={openPicker}
            className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink-500)] active:scale-95 transition"
          >
            <span className="text-base leading-none">👁</span> View as
          </button>
          <button
            onClick={() => setHiddenPersist(true)}
            aria-label="Hide control"
            className="h-6 w-6 rounded-full flex items-center justify-center text-[var(--color-ink-300)] hover:bg-[var(--color-ink-100)] text-base leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* ── CM picker ──────────────────────────────────────────────────── */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[75vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2 border-b border-[var(--color-ink-100)]">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-[var(--color-ink-700)]">
                  View as…
                </h2>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)] text-xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, market, role"
                className="mt-2 w-full rounded-xl bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none focus:border-[var(--color-tc-400)]"
              />
            </div>
            <div className="overflow-y-auto px-2 py-2">
              {cms === null ? (
                <div className="py-8 text-center text-sm text-[var(--color-ink-300)]">
                  Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--color-ink-300)]">
                  No matches
                </div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.telegram_id}
                    onClick={() => enter(c.telegram_id)}
                    disabled={busy}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--color-ink-50)] active:scale-[0.99] transition text-left disabled:opacity-50"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-[var(--color-ink-700)] truncate">
                        {c.name}
                      </span>
                      <span className="block text-xs text-[var(--color-ink-400)]">
                        {c.market} · {c.role.toUpperCase()}
                      </span>
                    </span>
                    <span className="text-[var(--color-ink-300)] text-lg">›</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
