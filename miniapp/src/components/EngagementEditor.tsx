"use client";

import { useEffect, useRef, useState } from "react";

// ─── Shapes shared with the visit pages + API ──────────────────────────────

export interface EngagementTrainingRow {
  product_id: string | null;
  product_name: string;
  response: string | null;
}

export interface EngagedPersonRow {
  id: string;
  staff_id: string | null;
  name: string;
  update_text: string | null;
  trainings: EngagementTrainingRow[];
}

// A product in the managed catalogue (sva.products via /api/m/products). id is
// kept so a picked training links back to the product row; custom-typed products
// pass a null id.
export interface ProductOption {
  id: string;
  brand: string;
  name: string;
}

// Offline fallback only — used if /api/m/products can't be reached. The live
// list comes from sva.products + the dashboard CRUD. Same names as the seed.
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
    "Marshall Milton A.N.C",
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

// Flatten the hard-coded catalogue into ProductOptions (id "" → unlinked) so the
// picker can render it when the live fetch fails.
const FALLBACK_PRODUCTS: ProductOption[] = Object.entries(PRODUCT_CATALOGUE).flatMap(
  ([brand, items]) =>
    items.map((display) => ({
      id: "",
      brand,
      name: display.startsWith(brand) ? display.slice(brand.length).trim() : display,
    })),
);

interface StoreStaff { id: string; name: string }

// ─── Local draft state ─────────────────────────────────────────────────────

interface TrainingDraft {
  key: string;
  product_id: string | null;
  product_name: string;
  response: string;
}

interface PersonDraft {
  key: string;
  staff_id: string | null; // set when linked to a known store-staff row
  name: string;
  update_text: string;
  trainings: TrainingDraft[];
}

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

// ─── Auto-growing, zoom-safe, keyboard-aware textarea ──────────────────────
// 16px font kills iOS focus-zoom even outside Telegram's WebView; height tracks
// content; on focus it lifts itself to the centre so the keyboard never hides
// the field the CM is typing into.
function AutoTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };

  useEffect(() => {
    if (ref.current) grow(ref.current);
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={2}
      onChange={(e) => {
        grow(e.currentTarget);
        onChange(e.target.value);
      }}
      onFocus={(e) => {
        // Defer so the keyboard has started opening before we re-centre.
        const el = e.currentTarget;
        setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
      }}
      placeholder={placeholder}
      className="w-full resize-none overflow-hidden rounded-lg border border-ink-100 bg-white px-3 py-2 text-[16px] leading-snug text-ink-700 placeholder:text-[13px] placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
    />
  );
}

// ─── Single-select product picker ──────────────────────────────────────────
function ProductPickerModal({
  personName,
  products,
  onClose,
  onPick,
}: {
  personName: string;
  products: ProductOption[];
  onClose: () => void;
  onPick: (pick: { product_id: string | null; product_name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const searchLc = search.trim().toLowerCase();

  // Group by brand; display name = brand + ' ' + name (matches stored strings).
  const byBrand = new Map<string, { id: string; display: string }[]>();
  for (const p of products) {
    const arr = byBrand.get(p.brand) ?? [];
    arr.push({ id: p.id, display: `${p.brand} ${p.name}` });
    byBrand.set(p.brand, arr);
  }
  const hasExactMatch = products.some(
    (p) => `${p.brand} ${p.name}`.toLowerCase() === searchLc,
  );

  return (
    <div className="fixed inset-x-0 top-0 h-dvh z-[70] bg-white flex flex-col">
      <header className="bg-white border-b border-ink-100 px-5 pt-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-2"
        >
          ‹ Back
        </button>
        <h1 className="text-xl font-extrabold text-ink-700 leading-tight">Pick a product</h1>
        <p className="mt-1 text-[12px] text-ink-400">
          For {personName || "this person"} — tap one to add the training.
        </p>
      </header>

      <div className="px-5 pt-3 pb-2 shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && search.trim()) {
              e.preventDefault();
              onPick({ product_id: null, product_name: search.trim() });
            }
          }}
          placeholder="Search or type a custom product…"
          className="w-full rounded-xl border border-ink-100 bg-white px-3 py-2 text-[16px] text-ink-700 placeholder:text-ink-300 focus:border-[var(--color-tc-200)] focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {[...byBrand.entries()].map(([brand, items]) => {
          const matches = items.filter((p) => !searchLc || p.display.toLowerCase().includes(searchLc));
          if (matches.length === 0) return null;
          return (
            <div key={brand} className="mb-1">
              <div className="px-1 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-ink-300">
                {brand}
              </div>
              {matches.map((p) => (
                <button
                  key={p.id || p.display}
                  type="button"
                  onClick={() => onPick({ product_id: p.id || null, product_name: p.display })}
                  className="w-full text-left rounded-lg px-3 py-2.5 text-[15px] text-ink-700"
                >
                  {p.display}
                </button>
              ))}
            </div>
          );
        })}
        {searchLc && !hasExactMatch && (
          <button
            type="button"
            onClick={() => onPick({ product_id: null, product_name: search.trim() })}
            className="w-full text-left rounded-lg px-3 py-2.5 text-[14px] mt-2 border-t border-ink-100 text-ink-500"
          >
            + Add &ldquo;<span className="font-bold text-ink-700">{search}</span>&rdquo; as custom product
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Editor ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  visitId: string;
  initData: string;
  people: EngagedPersonRow[];
  // When launched from the bot visit-flow, the primary action says "Next" and
  // closing routes the CM back to chat (handled by the parent). Defaults off.
  handoffMode?: boolean;
}

export default function EngagementEditor({
  open,
  onClose,
  onSaved,
  visitId,
  initData,
  people,
  handoffMode = false,
}: Props) {
  const [drafts, setDrafts] = useState<PersonDraft[]>([]);
  const [storeStaff, setStoreStaff] = useState<StoreStaff[] | null>(null);
  const [catalogue, setCatalogue] = useState<ProductOption[]>([]);
  const [pickerForKey, setPickerForKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed drafts from the people passed in whenever the sheet opens.
  useEffect(() => {
    if (!open) return;
    setDrafts(
      people.map((p) => ({
        key: nextKey(),
        staff_id: p.staff_id,
        name: p.name,
        update_text: p.update_text ?? "",
        trainings: p.trainings.map((t) => ({
          key: nextKey(),
          product_id: t.product_id,
          product_name: t.product_name,
          response: t.response ?? "",
        })),
      })),
    );
    setPickerForKey(null);

    fetch(`/api/m/visit/${visitId}/store-staff`, {
      headers: { Authorization: `tma ${initData}` },
    })
      .then((r) => r.json())
      .then((j) => setStoreStaff(j.staff ?? []))
      .catch(() => setStoreStaff([]));

    // Managed product catalogue for the training picker (mig 019). Falls back to
    // the hard-coded list if the endpoint can't be reached.
    fetch(`/api/m/products`, { headers: { Authorization: `tma ${initData}` } })
      .then((r) => r.json())
      .then((j) => setCatalogue(j.products ?? []))
      .catch(() => setCatalogue([]));
  }, [open, visitId, initData, people]);

  function patchPerson(key: string, patch: Partial<PersonDraft>) {
    setDrafts((curr) => curr.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addPerson(staff?: StoreStaff) {
    setDrafts((curr) => [
      ...curr,
      {
        key: nextKey(),
        staff_id: staff?.id ?? null,
        name: staff?.name ?? "",
        update_text: "",
        trainings: [],
      },
    ]);
  }

  function removePerson(key: string) {
    setDrafts((curr) => curr.filter((p) => p.key !== key));
  }

  function addTraining(personKey: string, pick: { product_id: string | null; product_name: string }) {
    setDrafts((curr) =>
      curr.map((p) =>
        p.key === personKey
          ? {
              ...p,
              trainings: [
                ...p.trainings,
                { key: nextKey(), product_id: pick.product_id, product_name: pick.product_name, response: "" },
              ],
            }
          : p,
      ),
    );
  }

  function patchTraining(personKey: string, tKey: string, patch: Partial<TrainingDraft>) {
    setDrafts((curr) =>
      curr.map((p) =>
        p.key === personKey
          ? { ...p, trainings: p.trainings.map((t) => (t.key === tKey ? { ...t, ...patch } : t)) }
          : p,
      ),
    );
  }

  function removeTraining(personKey: string, tKey: string) {
    setDrafts((curr) =>
      curr.map((p) =>
        p.key === personKey
          ? { ...p, trainings: p.trainings.filter((t) => t.key !== tKey) }
          : p,
      ),
    );
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        people: drafts
          .filter((p) => p.name.trim())
          .map((p) => ({
            staff_id: p.staff_id,
            person_name: p.staff_id ? null : p.name.trim(),
            update_text: p.update_text.trim() || null,
            trainings: p.trainings
              .filter((t) => t.product_name.trim())
              .map((t) => ({
                product_id: t.product_id,
                product_name: t.product_name.trim(),
                response: t.response.trim() || null,
              })),
          })),
      };
      const res = await fetch(`/api/m/visit/${visitId}/training`, {
        method: "PATCH",
        headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Hand-off launches from an inline web_app button (private chat), which
        // can't sendData() back to the bot — and doesn't need to: the visit flow
        // is non-blocking, so we just close the app after the PATCH saved.
        if (handoffMode) {
          onClose();
          return;
        }
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // Known staff not yet added as a person — offered as quick-add chips.
  const addedStaffIds = new Set(drafts.map((d) => d.staff_id).filter(Boolean) as string[]);
  const quickAdd = (storeStaff ?? []).filter((s) => !addedStaffIds.has(s.id));

  return (
    <div className="fixed inset-x-0 top-0 h-dvh z-50 bg-white flex flex-col">
      <header className="bg-white border-b border-ink-100 px-5 pt-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-2"
        >
          ‹ Back to visit
        </button>
        <h1 className="text-xl font-extrabold text-ink-700 leading-tight">People &amp; Training</h1>
        <p className="mt-1 text-[12px] text-ink-400">
          Log anyone you spoke to. Add an update, and a training if you ran one.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 space-y-3">
        {drafts.length === 0 && (
          <p className="text-center text-[13px] text-ink-300 py-4">
            No one logged yet. Add someone below.
          </p>
        )}

        {drafts.map((p) => (
          <div key={p.key} className="rounded-2xl border border-ink-100 bg-[var(--color-ink-50)] p-3">
            {/* Name */}
            <div className="flex items-center gap-2">
              {p.staff_id ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="text-[15px] font-bold text-ink-700">{p.name}</span>
                  <span className="rounded-full bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-100)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                    Store staff
                  </span>
                </div>
              ) : (
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => patchPerson(p.key, { name: e.target.value })}
                  onFocus={(e) => {
                    const el = e.currentTarget;
                    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
                  }}
                  placeholder="Who did you speak to?"
                  className="flex-1 rounded-lg border border-ink-100 bg-white px-3 py-2 text-[16px] font-semibold text-ink-700 placeholder:text-[13px] placeholder:text-ink-300 placeholder:font-normal focus:border-[var(--color-tc-200)] focus:outline-none"
                />
              )}
              <button
                type="button"
                onClick={() => removePerson(p.key)}
                aria-label="Remove person"
                className="shrink-0 h-7 w-7 rounded-full bg-ink-100 text-ink-400 text-sm leading-none"
              >
                ×
              </button>
            </div>

            {/* Update */}
            <div className="mt-2.5">
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-ink-400 mb-1">
                Update
              </label>
              <AutoTextarea
                value={p.update_text}
                onChange={(v) => patchPerson(p.key, { update_text: v })}
                placeholder="What did you talk about? Anything they said back?"
              />
            </div>

            {/* Trainings */}
            {p.trainings.length > 0 && (
              <div className="mt-2.5 space-y-2">
                {p.trainings.map((t) => (
                  <div key={t.key} className="rounded-xl border border-[var(--color-tc-100)] bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-100)] px-2 py-0.5 text-[12px] font-bold">
                        🎓 {t.product_name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTraining(p.key, t.key)}
                        aria-label="Remove training"
                        className="shrink-0 h-6 w-6 rounded-full bg-ink-100 text-ink-400 text-sm leading-none"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2">
                      <AutoTextarea
                        value={t.response}
                        onChange={(v) => patchTraining(p.key, t.key, { response: v })}
                        placeholder="How did they respond to this product?"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setPickerForKey(p.key)}
              className="mt-2.5 w-full rounded-xl border border-dashed border-[var(--color-tc-200)] px-3 py-2 text-[12px] font-bold text-[var(--color-tc-600)]"
            >
              + Add training
            </button>
          </div>
        ))}

        {/* Quick-add known store staff */}
        {quickAdd.length > 0 && (
          <div className="pt-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-ink-400 mb-1.5">
              People at this store
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickAdd.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addPerson(s)}
                  className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[13px] font-semibold text-ink-600"
                >
                  + {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => addPerson()}
          className="w-full rounded-xl border border-dashed border-ink-200 px-3 py-2.5 text-[13px] font-bold text-ink-500"
        >
          + Add someone else
        </button>
      </div>

      <div className="flex gap-2 px-5 py-3 border-t border-ink-100 bg-white shrink-0">
        <button
          onClick={onClose}
          className="flex-1 rounded-xl py-3 text-sm font-bold bg-ink-100 text-ink-500"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "var(--color-tc-600)" }}
        >
          {saving ? "Submitting…" : "Submit"}
        </button>
      </div>

      {pickerForKey && (
        <ProductPickerModal
          personName={drafts.find((d) => d.key === pickerForKey)?.name ?? ""}
          products={catalogue.length > 0 ? catalogue : FALLBACK_PRODUCTS}
          onClose={() => setPickerForKey(null)}
          onPick={(pick) => {
            addTraining(pickerForKey, pick);
            setPickerForKey(null);
          }}
        />
      )}
    </div>
  );
}
