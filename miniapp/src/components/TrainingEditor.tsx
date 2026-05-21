"use client";

import { useEffect, useState } from "react";

export interface TrainedStaffRow {
  staff_id: string;
  name: string;
  products: string | null;
  response: string | null;
}

// Hard-coded for Step 4 (Wilson vets); moves to a managed reference table in
// the dashboard later. Same shape as the original list in the view page.
export const PRODUCT_CATALOGUE: Record<string, string[]> = {
  Marshall: [
    "Marshall Acton III",
    "Marshall Stanmore III",
    "Marshall Woburn III",
    "Marshall Emberton II",
    "Marshall Willen",
    "Marshall Middleton",
    "Marshall Tufton",
    "Marshall Kilburn II",
    "Marshall Major V",
    "Marshall Motif II",
    "Marshall Monitor III A.N.C",
  ],
  "B&W": [
    "B&W Px7 S2e",
    "B&W Px8",
    "B&W Pi8",
    "B&W Pi6",
    "B&W Zeppelin",
    "B&W Panorama 3",
    "B&W 700 S3",
    "B&W 600 S3",
    "B&W Formation Wedge",
  ],
  Sonos: [
    "Sonos Era 100",
    "Sonos Era 300",
    "Sonos Arc Ultra",
    "Sonos Beam (Gen 2)",
    "Sonos Ray",
    "Sonos Move 2",
    "Sonos Roam 2",
    "Sonos Ace",
    "Sonos Sub Mini",
    "Sonos Sub (Gen 3)",
    "Sonos Five",
    "Sonos Port",
  ],
};

export function parseProductsCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface StoreStaff { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  visitId: string;
  initData: string;
  trainedStaff: TrainedStaffRow[];
}

// Modal sheet for editing trained staff on a visit. Self-contains all state
// (drafts, product picker, new-staff add) and the storeStaff fetch. Renders
// nothing when `open` is false.
//
// Shared between the visit view page and the edit page so the editor stays
// consistent — change here and both surfaces update.
export default function TrainingEditor({
  open,
  onClose,
  onSaved,
  visitId,
  initData,
  trainedStaff,
}: Props) {
  const [storeStaff, setStoreStaff] = useState<StoreStaff[] | null>(null);
  const [taggedStaffIds, setTaggedStaffIds] = useState<Set<string>>(new Set());
  const [trainingDrafts, setTrainingDrafts] = useState<Record<string, string>>({});
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState<Record<string, string>>({});
  const [openCombo, setOpenCombo] = useState<string | null>(null);
  const [savingTraining, setSavingTraining] = useState(false);
  const [addingStaff, setAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [creatingStaff, setCreatingStaff] = useState(false);

  // Seed drafts whenever the sheet opens — picks up the latest values from
  // whatever the caller passed for trainedStaff.
  useEffect(() => {
    if (!open) return;
    const products: Record<string, string> = {};
    const responses: Record<string, string> = {};
    const tagged = new Set<string>();
    for (const s of trainedStaff) {
      products[s.staff_id] = s.products ?? "";
      responses[s.staff_id] = s.response ?? "";
      tagged.add(s.staff_id);
    }
    setTrainingDrafts(products);
    setResponseDrafts(responses);
    setProductSearch({});
    setOpenCombo(null);
    setTaggedStaffIds(tagged);
    setAddingStaff(false);
    setNewStaffName("");

    fetch(`/api/m/visit/${visitId}/store-staff`, {
      headers: { Authorization: `tma ${initData}` },
    })
      .then((r) => r.json())
      .then((j) => setStoreStaff(j.staff ?? []))
      .catch(() => setStoreStaff([]));
  }, [open, visitId, initData, trainedStaff]);

  function toggleStaffTag(staffId: string) {
    setTaggedStaffIds((curr) => {
      const next = new Set(curr);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  }

  async function addNewStaff() {
    const name = newStaffName.trim();
    if (!name) return;
    setCreatingStaff(true);
    try {
      const res = await fetch(`/api/m/visit/${visitId}/staff`, {
        method: "POST",
        headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const { staff } = await res.json();
        setStoreStaff((curr) => {
          const list = curr ? [...curr, staff] : [staff];
          return list.sort((a, b) => a.name.localeCompare(b.name));
        });
        setTaggedStaffIds((curr) => new Set(curr).add(staff.id));
        setNewStaffName("");
        setAddingStaff(false);
      }
    } finally {
      setCreatingStaff(false);
    }
  }

  async function save() {
    setSavingTraining(true);
    try {
      const trained = Array.from(taggedStaffIds).map((staff_id) => ({
        staff_id,
        products: trainingDrafts[staff_id] ?? "",
        response: responseDrafts[staff_id] ?? "",
      }));
      const res = await fetch(`/api/m/visit/${visitId}/training`, {
        method: "PATCH",
        headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trained }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSavingTraining(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl px-5 pt-5 pb-8 shadow-xl max-h-[85vh] flex flex-col">
        <div className="w-8 h-1 bg-ink-200 rounded-full mx-auto mb-4" />
        <h2 className="text-base font-extrabold text-ink-700 mb-1">Training</h2>
        <p className="text-[11px] text-ink-300 mb-3">Tap staff you trained, then pick products + add how they responded.</p>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {storeStaff === null ? (
            <p className="text-center text-sm text-ink-300 py-6">Loading staff…</p>
          ) : storeStaff.length === 0 ? (
            <p className="text-center text-sm text-ink-300 py-6">No staff on file for this store yet.</p>
          ) : (
            storeStaff.map((s) => {
              const tagged = taggedStaffIds.has(s.id);
              const productsRaw = trainingDrafts[s.id] ?? "";
              const selected = parseProductsCsv(productsRaw);
              const selectedLc = new Set(selected.map((p) => p.toLowerCase()));
              const search = productSearch[s.id] ?? "";
              const searchLc = search.trim().toLowerCase();
              const comboOpen = openCombo === s.id;
              const responseDraft = responseDrafts[s.id] ?? "";

              const addProduct = (name: string) => {
                const trimmed = name.trim();
                if (!trimmed) return;
                if (selectedLc.has(trimmed.toLowerCase())) return;
                setTrainingDrafts((curr) => {
                  const existing = (curr[s.id] ?? "").trim();
                  const sep = existing === "" ? "" : ", ";
                  return { ...curr, [s.id]: existing + sep + trimmed };
                });
                setProductSearch((curr) => ({ ...curr, [s.id]: "" }));
              };
              const removeProduct = (name: string) => {
                setTrainingDrafts((curr) => ({
                  ...curr,
                  [s.id]: parseProductsCsv(curr[s.id] ?? "")
                    .filter((p) => p.toLowerCase() !== name.toLowerCase())
                    .join(", "),
                }));
              };
              const hasExactMatch = Object.values(PRODUCT_CATALOGUE)
                .some((items) => items.some((p) => p.toLowerCase() === searchLc));

              return (
                <div key={s.id} className={`rounded-xl border ${tagged ? "border-[var(--color-tc-200)] bg-[var(--color-tc-50)]" : "border-ink-100 bg-white"}`}>
                  <button
                    type="button"
                    onClick={() => toggleStaffTag(s.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold"
                  >
                    <span className={tagged ? "text-[var(--color-tc-600)]" : "text-ink-700"}>
                      {tagged ? "✓ " : ""}{s.name}
                    </span>
                    <span className="text-[11px] text-ink-300">
                      {tagged ? "tap to remove" : "tap to tag"}
                    </span>
                  </button>
                  {tagged && (
                    <div className="px-3 pb-3 pt-1 space-y-3">
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-400 mb-1.5">
                          Products trained on
                        </label>
                        <div className="relative">
                          <div
                            className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-100 bg-white px-2 py-1.5 min-h-[40px] cursor-text"
                            onClick={() => setOpenCombo(s.id)}
                          >
                            {selected.map((p) => (
                              <span
                                key={p}
                                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-100)] px-2 py-0.5 text-[11px] font-bold"
                              >
                                {p}
                                <button
                                  type="button"
                                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeProduct(p); }}
                                  className="text-[var(--color-tc-600)] opacity-60 hover:opacity-100 leading-none"
                                  aria-label={`Remove ${p}`}
                                >×</button>
                              </span>
                            ))}
                            <input
                              type="text"
                              value={search}
                              onFocus={() => setOpenCombo(s.id)}
                              onChange={(e) => {
                                setProductSearch((curr) => ({ ...curr, [s.id]: e.target.value }));
                                setOpenCombo(s.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (search.trim()) addProduct(search);
                                } else if (e.key === "Backspace" && search === "" && selected.length > 0) {
                                  removeProduct(selected[selected.length - 1]);
                                }
                              }}
                              placeholder={selected.length === 0 ? "Search products, or type a custom name…" : ""}
                              className="flex-1 min-w-[120px] bg-transparent text-[13px] text-ink-700 placeholder:text-ink-300 focus:outline-none py-0.5"
                            />
                          </div>
                          {comboOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onMouseDown={() => setOpenCombo(null)} />
                              <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-[200px] overflow-y-auto rounded-xl border border-ink-100 bg-white shadow-lg p-1">
                                {Object.entries(PRODUCT_CATALOGUE).map(([brand, items]) => {
                                  const matches = items.filter((p) => !searchLc || p.toLowerCase().includes(searchLc));
                                  if (matches.length === 0) return null;
                                  return (
                                    <div key={brand}>
                                      <div className="px-2 pt-2 pb-0.5 text-[9px] font-extrabold uppercase tracking-wider text-ink-300">
                                        {brand}
                                      </div>
                                      {matches.map((p) => {
                                        const isSelected = selectedLc.has(p.toLowerCase());
                                        return (
                                          <button
                                            key={p}
                                            type="button"
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              if (isSelected) removeProduct(p);
                                              else addProduct(p);
                                            }}
                                            className={`w-full text-left rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-ink-50 flex items-center justify-between ${
                                              isSelected ? "font-bold text-[var(--color-tc-600)]" : "text-ink-700"
                                            }`}
                                          >
                                            <span>{p}</span>
                                            {isSelected && <span>✓</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                                {searchLc && !hasExactMatch && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => { e.preventDefault(); addProduct(search); }}
                                    className="w-full text-left rounded-lg px-2.5 py-2 text-[12px] mt-1 border-t border-ink-100 text-ink-500 hover:bg-ink-50"
                                  >
                                    + Add &ldquo;<span className="font-bold text-ink-700">{search}</span>&rdquo; as custom product
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-400 mb-1.5">
                          How was the response?
                        </label>
                        <textarea
                          value={responseDraft}
                          onChange={(e) =>
                            setResponseDrafts((curr) => ({ ...curr, [s.id]: e.target.value }))
                          }
                          placeholder="What clicked? Any objections? Anything they said back?"
                          rows={2}
                          className="w-full resize-none rounded-lg border border-ink-100 bg-white px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {addingStaff ? (
            <div className="rounded-xl border border-ink-100 bg-white px-3 py-2.5 flex items-center gap-2">
              <input
                type="text"
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                placeholder="Staff name"
                autoFocus
                className="flex-1 bg-transparent text-[13px] text-ink-700 placeholder:text-ink-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={addNewStaff}
                disabled={creatingStaff || !newStaffName.trim()}
                className="rounded-full px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                style={{ background: "var(--color-tc-600)" }}
              >
                {creatingStaff ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => { setAddingStaff(false); setNewStaffName(""); }}
                className="text-[11px] font-bold text-ink-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingStaff(true)}
              className="w-full rounded-xl border border-dashed border-ink-200 px-3 py-2.5 text-[12px] font-bold text-ink-500"
            >
              + Add new staff
            </button>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-3 text-sm font-bold bg-ink-100 text-ink-500"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={savingTraining}
            className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "var(--color-tc-600)" }}
          >
            {savingTraining ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
