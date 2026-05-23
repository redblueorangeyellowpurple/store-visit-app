"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { initTelegram } from "../../../telegram-init";
import { useSwipeBack } from "@/lib/useSwipeBack";

interface DraftItem {
  id: number; // local-only key for React lists
  title: string;
  notes: string;
  due_date: string; // YYYY-MM-DD or ""
  assigned_to_telegram_id: number | null;
}

function newDraft(id: number, assignee: number | null): DraftItem {
  return { id, title: "", notes: "", due_date: "", assigned_to_telegram_id: assignee };
}

interface VisitMeta {
  id: string;
  store_id: string;
  store_name: string;
}

interface CMOption {
  telegram_id: number;
  name: string;
}

interface WhoAmI {
  telegram_id: number;
  name: string;
  market: string;
}

export default function FollowUpFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [meta, setMeta] = useState<VisitMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[]>([newDraft(0, null)]);
  const [nextId, setNextId] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [me, setMe] = useState<WhoAmI | null>(null);
  const [cms, setCms] = useState<CMOption[]>([]);
  useSwipeBack();

  useEffect(() => {
    (async () => {
      const td = await initTelegram();
      if (!td) { setError("Open this from inside Telegram."); return; }
      setInitData(td);
      // Fetch visit meta, current CM, and assignee options in parallel.
      const [visitRes, whoRes, cmsRes] = await Promise.all([
        fetch(`/api/m/visit/${id}`, { headers: { Authorization: `tma ${td}` } }),
        fetch(`/api/m/whoami`, { headers: { Authorization: `tma ${td}` } }),
        fetch(`/api/m/cms`, { headers: { Authorization: `tma ${td}` } }),
      ]);
      if (!visitRes.ok) {
        const body = await visitRes.json().catch(() => ({}));
        setError(body.error ?? `Failed (${visitRes.status})`);
        return;
      }
      const data = await visitRes.json();
      setMeta({
        id: data.visit.id,
        store_id: data.visit.store_id,
        store_name: data.visit.store_name,
      });
      if (whoRes.ok) {
        const who = (await whoRes.json()) as WhoAmI;
        setMe(who);
        // Pre-fill default assignee on the seeded first item.
        setItems((curr) => curr.map((it) => ({ ...it, assigned_to_telegram_id: who.telegram_id })));
      }
      if (cmsRes.ok) {
        const j = await cmsRes.json();
        setCms(j.cms ?? []);
      }
    })().catch((e) => setError(String(e)));
  }, [id]);

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((curr) => curr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function removeItem(i: number) {
    setItems((curr) => (curr.length === 1 ? curr : curr.filter((_, idx) => idx !== i)));
  }

  function addAnother() {
    setItems((curr) => [...curr, newDraft(nextId, me?.telegram_id ?? null)]);
    setNextId((n) => n + 1);
  }

  async function saveAndDone() {
    if (!initData) return;
    const payload = items
      .map((it) => ({
        title: it.title.trim(),
        notes: it.notes.trim() || null,
        due_date: it.due_date.trim() || null,
        assigned_to_telegram_id: it.assigned_to_telegram_id ?? me?.telegram_id ?? null,
      }))
      .filter((it) => it.title);
    // Empty submission is valid — CM is saying "no follow-ups, finalize now."
    setSaving(true);
    setError(null);
    try {
      // Save first (only if there are items). Skip on empty so the
      // followup endpoint's "at least one" guard doesn't 400.
      if (payload.length > 0) {
        const saveRes = await fetch(`/api/m/visit/${id}/followup`, {
          method: "POST",
          headers: {
            Authorization: `tma ${initData}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ items: payload }),
        });
        if (!saveRes.ok) {
          const body = await saveRes.json().catch(() => ({}));
          setError(body.error ?? `Save failed (${saveRes.status})`);
          return;
        }
      }
      // Finalize — locks the visit + the bot sends the done message.
      const finalRes = await fetch(`/api/m/visit/${id}/finalize`, {
        method: "POST",
        headers: { Authorization: `tma ${initData}` },
      });
      if (!finalRes.ok) {
        const body = await finalRes.json().catch(() => ({}));
        setError(body.error ?? `Submit failed (${finalRes.status})`);
        return;
      }
      setSavedCount(payload.length);
      // Telegram WebApp close — returns user to the bot chat. Falls back to
      // navigating to the visit page in browsers (e.g. dev preview).
      const tg = (window as Window & {
        Telegram?: { WebApp?: { close?: () => void } };
      }).Telegram?.WebApp;
      if (tg?.close) {
        setTimeout(() => tg.close?.(), 800);
      }
    } finally {
      setSaving(false);
    }
  }

  if (error && !meta) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-400">{error}</p>
      </main>
    );
  }
  if (!meta) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="bg-white border-b border-ink-100 px-4 pt-4 pb-4">
        <Link
          href={`/m/visit/${meta.id}`}
          className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-3"
        >
          ‹ Back to visit
        </Link>
        <h1 className="text-xl font-extrabold text-ink-700 leading-tight">
          Add Follow-Ups
        </h1>
        <p className="mt-1 text-[12px] text-ink-400">{meta.store_name}</p>
      </header>

      <div className="space-y-3 px-3.5 mt-4">
        {items.map((it, i) => (
          <div key={it.id} className="rounded-[18px] border border-ink-100 bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-400">
                Item {i + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-[11px] font-bold text-ink-300"
                >
                  × Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={it.title}
              onChange={(e) => updateItem(i, { title: e.target.value })}
              placeholder="Title — what needs doing"
              className="w-full rounded-lg border border-ink-100 bg-white px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
            />
            <textarea
              value={it.notes}
              onChange={(e) => updateItem(i, { notes: e.target.value })}
              placeholder="Notes (optional)"
              rows={2}
              className="mt-2 w-full resize-none rounded-lg border border-ink-100 bg-white px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] font-semibold text-ink-400 w-12 shrink-0">Due:</label>
              <input
                type="date"
                value={it.due_date}
                onChange={(e) => updateItem(i, { due_date: e.target.value })}
                className="flex-1 rounded-lg border border-ink-100 bg-white px-2 py-1.5 text-[12px] text-ink-700 focus:border-[var(--color-tc-200)] focus:outline-none"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] font-semibold text-ink-400 w-12 shrink-0">Assign:</label>
              <select
                value={it.assigned_to_telegram_id ?? ""}
                onChange={(e) =>
                  updateItem(i, {
                    assigned_to_telegram_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="flex-1 rounded-lg border border-ink-100 bg-white px-2 py-1.5 text-[12px] text-ink-700 focus:border-[var(--color-tc-200)] focus:outline-none"
              >
                {me && (
                  <option value={me.telegram_id}>
                    {me.name} (me)
                  </option>
                )}
                {cms
                  .filter((c) => c.telegram_id !== me?.telegram_id)
                  .map((c) => (
                    <option key={c.telegram_id} value={c.telegram_id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addAnother}
          className="w-full rounded-xl border border-dashed border-ink-200 px-3 py-2.5 text-[12px] font-bold text-ink-500"
        >
          + Add another
        </button>

        {error && (
          <p className="text-center text-[12px] text-rose-600">{error}</p>
        )}
        {savedCount !== null && (
          <p className="text-center text-[12px] text-emerald-600 font-semibold">
            ✓ Submitted{savedCount > 0
              ? ` — ${savedCount} follow-up${savedCount === 1 ? "" : "s"} saved`
              : ""}. Returning to bot…
          </p>
        )}

        <div className="flex gap-2 mt-3">
          <Link
            href={`/m/visit/${meta.id}`}
            className="flex-1 rounded-xl py-3 text-center text-sm font-bold bg-ink-100 text-ink-500"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={saveAndDone}
            disabled={saving || savedCount !== null}
            className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "var(--color-tc-600)" }}
          >
            {saving
              ? "Submitting…"
              : savedCount !== null
                ? "Submitted"
                : "Save & Done"}
          </button>
        </div>
      </div>
    </main>
  );
}
