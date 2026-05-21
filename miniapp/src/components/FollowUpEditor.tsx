"use client";

import { useEffect, useState } from "react";

export interface FollowUpRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
  closed_at: string | null;
  created_at: string;
}

interface Draft {
  // For existing rows: the row id. For new drafts: null until saved.
  id: string | null;
  title: string;
  notes: string;
  due_date: string;
  status: "open" | "done" | "cancelled";
  // Local tracking
  _deleted?: boolean;
  // Snapshot of the original (for diffing existing rows on save). Null for new drafts.
  _original?: { title: string; notes: string; due_date: string; status: "open" | "done" | "cancelled" } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  visitId: string;
  initData: string;
  followUps: FollowUpRow[];
}

// Modal sheet for editing follow-ups on a visit. Lets the CM tick done, edit
// title/notes/due date, delete, and add new items inline — all saved in a
// single Save click that diffs against the originals.
//
// Shared between the visit view page and the edit page so the editor stays
// consistent — change here and both surfaces update.
export default function FollowUpEditor({
  open,
  onClose,
  onSaved,
  visitId,
  initData,
  followUps,
}: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed drafts whenever the sheet opens — picks up the latest values from
  // whatever the caller passed for followUps.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDrafts(
      followUps.map((f) => ({
        id: f.id,
        title: f.title,
        notes: f.notes ?? "",
        due_date: f.due_date ?? "",
        status: f.status,
        _original: {
          title: f.title,
          notes: f.notes ?? "",
          due_date: f.due_date ?? "",
          status: f.status,
        },
      })),
    );
  }, [open, followUps]);

  function updateDraft(idx: number, patch: Partial<Draft>) {
    setDrafts((curr) => curr.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function toggleDone(idx: number) {
    setDrafts((curr) =>
      curr.map((d, i) =>
        i === idx ? { ...d, status: d.status === "done" ? "open" : "done" } : d,
      ),
    );
  }

  function removeDraft(idx: number) {
    setDrafts((curr) => {
      const d = curr[idx];
      // For unsaved new drafts (no id), just drop them. For existing rows,
      // flag _deleted so we can hit DELETE on save.
      if (!d.id) return curr.filter((_, i) => i !== idx);
      return curr.map((it, i) => (i === idx ? { ...it, _deleted: true } : it));
    });
  }

  function undoRemove(idx: number) {
    setDrafts((curr) => curr.map((d, i) => (i === idx ? { ...d, _deleted: false } : d)));
  }

  function addDraft() {
    setDrafts((curr) => [
      ...curr,
      { id: null, title: "", notes: "", due_date: "", status: "open", _original: null },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // 1. Deletes
      const toDelete = drafts.filter((d) => d.id && d._deleted);
      for (const d of toDelete) {
        const res = await fetch(`/api/m/visit/${visitId}/followup/${d.id}`, {
          method: "DELETE",
          headers: { Authorization: `tma ${initData}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Delete failed (${res.status})`);
          return;
        }
      }

      // 2. Patches — existing rows that changed
      const toPatch = drafts.filter((d) => d.id && !d._deleted && d._original);
      for (const d of toPatch) {
        const orig = d._original!;
        const patch: Record<string, unknown> = {};
        if (d.title.trim() !== orig.title) patch.title = d.title.trim();
        if (d.notes !== orig.notes) patch.notes = d.notes.trim() || null;
        if (d.due_date !== orig.due_date) patch.due_date = d.due_date || null;
        if (d.status !== orig.status) patch.status = d.status;
        if (Object.keys(patch).length === 0) continue;
        if (patch.title !== undefined && !(patch.title as string)) {
          setError("Title cannot be empty");
          return;
        }
        const res = await fetch(`/api/m/visit/${visitId}/followup/${d.id}`, {
          method: "PATCH",
          headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Save failed (${res.status})`);
          return;
        }
      }

      // 3. New items — POST in one batch
      const toCreate = drafts
        .filter((d) => !d.id && !d._deleted && d.title.trim())
        .map((d) => ({
          title: d.title.trim(),
          notes: d.notes.trim() || null,
          due_date: d.due_date || null,
        }));
      if (toCreate.length > 0) {
        const res = await fetch(`/api/m/visit/${visitId}/followup`, {
          method: "POST",
          headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
          body: JSON.stringify({ items: toCreate }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Add failed (${res.status})`);
          return;
        }
      }

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const visibleDrafts = drafts.filter((d) => !d._deleted);
  const deletedCount = drafts.filter((d) => d._deleted).length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl px-5 pt-5 pb-8 shadow-xl max-h-[85vh] flex flex-col">
        <div className="w-8 h-1 bg-ink-200 rounded-full mx-auto mb-4" />
        <h2 className="text-base font-extrabold text-ink-700 mb-1">Follow-ups</h2>
        <p className="text-[11px] text-ink-300 mb-3">
          Tick to mark done. Edit title/due/notes inline. Add new tasks below.
        </p>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {visibleDrafts.length === 0 ? (
            <p className="text-center text-sm text-ink-300 py-4">
              No follow-ups yet. Tap &ldquo;+ Add another&rdquo; to start.
            </p>
          ) : (
            drafts.map((d, idx) => {
              if (d._deleted) return null;
              const done = d.status === "done";
              return (
                <div
                  key={d.id ?? `new-${idx}`}
                  className={`rounded-xl border ${done ? "border-ink-100 bg-ink-50" : "border-ink-100 bg-white"} p-3`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggleDone(idx)}
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-ink-200 bg-white text-transparent"
                      } text-[12px] font-bold leading-none`}
                      aria-label={done ? "Mark as open" : "Mark as done"}
                    >
                      {done ? "✓" : ""}
                    </button>

                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        type="text"
                        value={d.title}
                        onChange={(e) => updateDraft(idx, { title: e.target.value })}
                        placeholder="Title — what needs doing"
                        className={`w-full rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 text-[13px] ${
                          done ? "text-ink-300 line-through" : "text-ink-700"
                        } placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none`}
                      />
                      <textarea
                        value={d.notes}
                        onChange={(e) => updateDraft(idx, { notes: e.target.value })}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="w-full resize-none rounded-lg border border-ink-100 bg-white px-2.5 py-1.5 text-[12px] text-ink-700 placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                          Due
                        </label>
                        <input
                          type="date"
                          value={d.due_date}
                          onChange={(e) => updateDraft(idx, { due_date: e.target.value })}
                          className="flex-1 rounded-lg border border-ink-100 bg-white px-2 py-1 text-[12px] text-ink-700 focus:border-[var(--color-tc-200)] focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeDraft(idx)}
                      className="shrink-0 text-[11px] font-bold text-rose-500 px-1"
                      aria-label="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <button
            type="button"
            onClick={addDraft}
            className="w-full rounded-xl border border-dashed border-ink-200 px-3 py-2.5 text-[12px] font-bold text-ink-500"
          >
            + Add another
          </button>

          {deletedCount > 0 && (
            <div className="space-y-1 pt-2 border-t border-ink-100">
              <p className="text-[10px] uppercase tracking-wider font-bold text-ink-300">
                Removed ({deletedCount}) — will delete on save
              </p>
              {drafts.map((d, idx) =>
                d._deleted ? (
                  <div
                    key={d.id ?? `del-${idx}`}
                    className="flex items-center justify-between text-[12px] text-ink-300"
                  >
                    <span className="line-through truncate">{d.title || "(untitled)"}</span>
                    <button
                      type="button"
                      onClick={() => undoRemove(idx)}
                      className="text-[11px] font-bold text-[var(--color-tc-600)]"
                    >
                      Undo
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {error && <p className="text-center text-[12px] text-rose-600">{error}</p>}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold bg-ink-100 text-ink-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "var(--color-tc-600)" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
