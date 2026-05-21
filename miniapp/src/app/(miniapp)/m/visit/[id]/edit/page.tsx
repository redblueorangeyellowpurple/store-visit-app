"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { initTelegram } from "../../../telegram-init";
import { useSwipeBack } from "@/lib/useSwipeBack";

interface FullVisit {
  id: string;
  store_id: string;
  store_name: string;
  visit_date: string;
  good_news: string | null;
  people_training: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  photo_count: number;
  is_locked: boolean;
}

type SectionKey =
  | "good_news"
  | "people_training"
  | "competitors"
  | "display_stock"
  | "follow_up"
  | "buzz_plan";

// Photo enum (visit_photos.section_key) — uses 'competitor' singular while
// the visits text column is 'competitors' plural. PhotoSection maps between
// the two.
type PhotoSection =
  | "good_news"
  | "people_training"
  | "competitor"
  | "display_stock"
  | "follow_up"
  | null;

interface PhotoRow {
  id: string;
  storage_path: string;
  section_key: PhotoSection;
  url: string | null;
}

interface SectionConfig {
  key: SectionKey;
  // Null = section doesn't accept photos in the editor (legacy text-only).
  photoSection: Exclude<PhotoSection, null | "follow_up"> | null;
  label: string;
  icon: string;
  iconBgClass: string;
  titleClass: string;
  placeholder: string;
  legacy?: boolean;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "good_news",
    photoSection: "good_news",
    label: "Good News",
    icon: "🎉",
    iconBgClass: "bg-[var(--color-section-amber-bg)]",
    titleClass: "text-[var(--color-tc-600)]",
    placeholder: "Wins, breakthroughs, customer compliments, staff good news…",
  },
  {
    key: "people_training",
    photoSection: "people_training",
    label: "People & Training",
    icon: "👥",
    iconBgClass: "bg-[var(--color-section-teal-bg)]",
    titleClass: "text-[var(--color-section-teal-fg)]",
    placeholder: "Who you engaged, what you talked about, how they responded…",
  },
  {
    key: "competitors",
    photoSection: "competitor",
    label: "Competitor Insights",
    icon: "🔍",
    iconBgClass: "bg-[var(--color-section-blue-bg)]",
    titleClass: "text-[var(--color-tier-t1-fg)]",
    placeholder: "Bose / Sony / JBL — promos, products, POS, gossip from staff…",
  },
  {
    key: "display_stock",
    photoSection: "display_stock",
    label: "Display & Stock",
    icon: "📦",
    iconBgClass: "bg-[var(--color-section-green-bg)]",
    titleClass: "text-[var(--color-tier-t2-fg)]",
    placeholder: "Display health, stock levels, POSM/buzz materials, new spaces…",
  },
  {
    key: "follow_up",
    photoSection: null,
    label: "Follow-up (legacy text)",
    icon: "✅",
    iconBgClass: "bg-[var(--color-section-pink-bg)]",
    titleClass: "text-[#C0185A]",
    placeholder: "Structured follow-ups live in the follow-ups list — this is the legacy freetext column.",
    legacy: true,
  },
  {
    key: "buzz_plan",
    photoSection: null,
    label: "Buzz Plan (legacy)",
    icon: "⚡",
    iconBgClass: "bg-[var(--color-section-purple-bg)]",
    titleClass: "text-[#5B2DB5]",
    placeholder: "Planned activities (legacy column — v2 visits don't write here).",
    legacy: true,
  },
];

// Section labels for the "Move to…" menu on Other photos.
const MOVE_TARGETS: { value: Exclude<PhotoSection, null | "follow_up">; label: string; icon: string }[] = [
  { value: "good_news", label: "Good News", icon: "🎉" },
  { value: "people_training", label: "People & Training", icon: "👥" },
  { value: "competitor", label: "Competitor", icon: "🔍" },
  { value: "display_stock", label: "Display & Stock", icon: "📦" },
];

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function EditVisitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  useSwipeBack();

  const [visit, setVisit] = useState<FullVisit | null>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [fields, setFields] = useState<Record<SectionKey, string>>({
    good_news: "",
    people_training: "",
    competitors: "",
    display_stock: "",
    follow_up: "",
    buzz_plan: "",
  });
  const [initDataStr, setInitDataStr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Per-section upload busy state (so each card's "+ Photo" can spin
  // independently and disabling one doesn't lock the others).
  const [uploadingFor, setUploadingFor] = useState<PhotoSection>(null);
  const [movingPhotoId, setMovingPhotoId] = useState<string | null>(null);
  const [openMoveMenuFor, setOpenMoveMenuFor] = useState<string | null>(null);
  // One hidden input per section so the file picker knows which section_key
  // to attach. Keyed by the photo enum value.
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    (async () => {
      const initData = await initTelegram();
      if (!initData) { setError("Open this from inside Telegram."); return; }
      setInitDataStr(initData);

      const res = await fetch(`/api/m/visit/${id}`, {
        headers: { Authorization: `tma ${initData}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setVisit(data.visit);
      setPhotos((data.photos ?? []) as PhotoRow[]);
      setFields({
        good_news: data.visit.good_news ?? "",
        people_training: data.visit.people_training ?? "",
        competitors: data.visit.competitors ?? "",
        display_stock: data.visit.display_stock ?? "",
        follow_up: data.visit.follow_up ?? "",
        buzz_plan: data.visit.buzz_plan ?? "",
      });
    })().catch((e) => setError(String(e)));
  }, [id]);

  async function handleSave() {
    if (!initDataStr || !visit || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/m/visit/${id}`, {
        method: "PATCH",
        headers: {
          Authorization: `tma ${initDataStr}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => router.push(`/m/visit/${id}`), 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoSelected(
    e: React.ChangeEvent<HTMLInputElement>,
    sectionKey: Exclude<PhotoSection, null | "follow_up">,
  ) {
    const file = e.target.files?.[0];
    if (!file || !initDataStr) return;
    e.target.value = "";

    setUploadingFor(sectionKey);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("section_key", sectionKey);
      const res = await fetch(`/api/m/visit/${id}/photos`, {
        method: "POST",
        headers: { Authorization: `tma ${initDataStr}` },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Photo upload failed");
        return;
      }
      const { id: newId, url, path } = await res.json();
      if (newId && url) {
        setPhotos((prev) => [
          ...prev,
          { id: newId, storage_path: path, section_key: sectionKey, url },
        ]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setUploadingFor(null);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!initDataStr) return;
    if (!confirm("Delete this photo? This can't be undone.")) return;
    setError(null);
    try {
      const res = await fetch(`/api/m/visit/${id}/photos/${photoId}`, {
        method: "DELETE",
        headers: { Authorization: `tma ${initDataStr}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Delete failed");
        return;
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      setError(String(err));
    }
  }

  async function movePhoto(
    photoId: string,
    sectionKey: Exclude<PhotoSection, null | "follow_up">,
  ) {
    if (!initDataStr) return;
    setMovingPhotoId(photoId);
    setError(null);
    try {
      const res = await fetch(`/api/m/visit/${id}/photos/${photoId}`, {
        method: "PATCH",
        headers: {
          Authorization: `tma ${initDataStr}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ section_key: sectionKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Move failed");
        return;
      }
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, section_key: sectionKey } : p)),
      );
      setOpenMoveMenuFor(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setMovingPhotoId(null);
    }
  }

  if (error && !visit) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-400">{error}</p>
      </main>
    );
  }
  if (!visit) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    );
  }

  // Group photos by section_key. Anything not matching one of the four active
  // sections (NULL, legacy 'follow_up') falls into "Other photos" with a
  // "Move to…" picker so the CM can re-home it.
  const photosBySection = new Map<string, PhotoRow[]>();
  const otherPhotos: PhotoRow[] = [];
  for (const p of photos) {
    if (
      p.section_key === "good_news" ||
      p.section_key === "people_training" ||
      p.section_key === "competitor" ||
      p.section_key === "display_stock"
    ) {
      const arr = photosBySection.get(p.section_key) ?? [];
      arr.push(p);
      photosBySection.set(p.section_key, arr);
    } else {
      otherPhotos.push(p);
    }
  }

  return (
    <main className="min-h-screen pb-28">
      {/* Header */}
      <header className="bg-white border-b border-ink-100 px-4 pt-4 pb-4">
        <button
          onClick={() => router.push(`/m/visit/${id}`)}
          className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-3"
        >
          ‹ Cancel
        </button>
        <h1 className="text-xl font-extrabold text-ink-700 leading-tight">Edit visit</h1>
        <p className="text-xs text-ink-300 mt-0.5">
          {fmtDate(visit.visit_date)} · {visit.store_name}
        </p>
      </header>

      {/* Section cards — text + per-section photo strip */}
      <div className="space-y-2 px-3.5 mt-4">
        {SECTIONS.filter((s) => !s.legacy || fields[s.key].trim().length > 0).map((s) => {
          const sectionPhotos = s.photoSection
            ? (photosBySection.get(s.photoSection) ?? [])
            : [];
          const isUploading = s.photoSection !== null && uploadingFor === s.photoSection;
          return (
            <div key={s.key} className="rounded-[18px] border border-ink-100 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${s.iconBgClass}`}>
                  {s.icon}
                </span>
                <span className={`text-[10px] font-extrabold uppercase tracking-wider ${s.titleClass}`}>
                  {s.label}
                </span>
              </div>
              <textarea
                value={fields[s.key]}
                onChange={(e) => setFields((prev) => ({ ...prev, [s.key]: e.target.value }))}
                placeholder={s.placeholder}
                rows={3}
                className="w-full resize-none rounded-xl bg-ink-50 px-3 py-2.5 text-[13px] text-ink-600 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-tc-500)] leading-relaxed"
              />

              {/* Per-section photo strip. Hidden entirely on legacy sections
                  that don't accept photos. */}
              {s.photoSection && (
                <div className="mt-3 flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-hide">
                  {sectionPhotos.map((p) => (
                    <div
                      key={p.id}
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-100"
                    >
                      {p.url && (
                        <Image
                          src={p.url}
                          alt={s.label}
                          fill
                          className="object-cover"
                          sizes="80px"
                          unoptimized
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => deletePhoto(p.id)}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white text-[11px] leading-none"
                        aria-label="Delete photo"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRefs.current[s.photoSection!]?.click()}
                    className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink-200 bg-white text-ink-300 transition-colors active:bg-ink-50 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <span className="text-xs text-ink-300">…</span>
                    ) : (
                      <>
                        <span className="text-2xl leading-none">+</span>
                        <span className="text-[9px] font-semibold uppercase tracking-wide">Photo</span>
                      </>
                    )}
                  </button>
                  <input
                    ref={(el) => { fileInputRefs.current[s.photoSection!] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handlePhotoSelected(e, s.photoSection!)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Other photos — untagged + legacy 'follow_up' photos. CM can move
            each one into a structured section, or delete. */}
        {otherPhotos.length > 0 && (
          <div className="rounded-[18px] border border-ink-100 bg-white p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-sm">
                📸
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-400">
                Other photos
              </span>
            </div>
            <p className="text-[11px] text-ink-300 mb-3">
              Tap a photo to file it under a section.
            </p>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-hide">
              {otherPhotos.map((p) => (
                <div key={p.id} className="relative h-20 w-20 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenMoveMenuFor(openMoveMenuFor === p.id ? null : p.id)}
                    className="relative h-20 w-20 overflow-hidden rounded-xl bg-ink-100"
                  >
                    {p.url && (
                      <Image
                        src={p.url}
                        alt="Photo"
                        fill
                        className="object-cover"
                        sizes="80px"
                        unoptimized
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePhoto(p.id)}
                    className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white text-[11px] leading-none"
                    aria-label="Delete photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Move-to menu — appears below the strip when a thumb is tapped */}
            {openMoveMenuFor && (
              <div className="mt-3 rounded-xl border border-ink-100 bg-ink-50 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 px-1 pb-1.5">
                  Move to…
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {MOVE_TARGETS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      disabled={movingPhotoId === openMoveMenuFor}
                      onClick={() => movePhoto(openMoveMenuFor, t.value)}
                      className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-2 text-[12px] font-semibold text-ink-600 disabled:opacity-50"
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenMoveMenuFor(null)}
                  className="mt-1.5 w-full text-center text-[11px] text-ink-400 py-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Follow-ups manager — go to the structured form */}
        <div className="rounded-[18px] border border-ink-100 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-section-pink-bg)] text-sm">
                ✅
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C0185A]">
                Follow-ups
              </span>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/m/visit/${id}/followup`)}
              className="rounded-full bg-[var(--color-section-pink-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[#C0185A]"
            >
              Manage
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-300">
            Structured follow-ups live in their own form. Tap Manage to add or update them.
          </p>
        </div>

        {error && (
          <p className="text-center text-[12px] text-rose-600">{error}</p>
        )}
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-ink-100 px-4 py-3 safe-area-bottom">
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className="w-full rounded-2xl py-3.5 text-sm font-bold transition-all disabled:opacity-60"
          style={{
            background: saved
              ? "var(--color-tier-t2-bg)"
              : "linear-gradient(135deg, var(--color-tc-500) 0%, var(--color-tc-600) 100%)",
            color: saved ? "var(--color-tier-t2-fg)" : "#fff",
          }}
        >
          {saved ? "✓ Saved" : saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </main>
  );
}
