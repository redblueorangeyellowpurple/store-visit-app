"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { initTelegram } from "../../telegram-init";
import { useSwipeBack } from "@/lib/useSwipeBack";
import EngagementEditor, { type EngagedPersonRow } from "@/components/EngagementEditor";

interface VisitCM {
  telegram_id: number;
  role: 'lead' | 'co';
  name: string;
}

interface FollowUpRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  closed_at: string | null;
}

// AM review feedback, surfaced read-only to the CM (sva.photo_comments +
// sva.photo_annotations). Boxed fixes are positioned in % of the image.
interface PhotoComment {
  id: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

interface PhotoAnnotation {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
  author_name: string | null;
  created_at: string;
}

interface PhotoWithSection {
  id: string;
  storage_path: string;
  section_key:
    | 'good_news'
    | 'people_training'
    | 'competitor'
    | 'display_stock'
    | 'follow_up'
    | null;
  url: string | null;
  comments: PhotoComment[];
  annotations: PhotoAnnotation[];
}

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
  edited_at: string | null;
  grade: 1 | 2 | 3 | null;
  grade_comments: string | null;
  cms: VisitCM[];
  engaged_people: EngagedPersonRow[];
  viewer_is_lead: boolean;
  follow_ups: FollowUpRow[];
  review_ack_at: string | null;
}

const GRADE_STYLES: Record<1 | 2 | 3, { label: string; pill: string }> = {
  1: { label: "Grade 1", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  2: { label: "Grade 2", pill: "bg-amber-50 text-amber-700 border-amber-200" },
  3: { label: "Grade 3", pill: "bg-rose-50 text-rose-700 border-rose-200" },
};

interface VisitPayload {
  visit: FullVisit;
  photoUrls: string[]; // back-compat (full list, in DB order)
  photos: PhotoWithSection[];
  canEditCoCMs: boolean;
  canEditTraining: boolean;
  canDelete: boolean;
}

interface MarketCM { telegram_id: number; name: string }

// Visit-v2 section order: 4 sections. Legacy buzz_plan column folds into the
// People & Training card as an inline sub-block (going forward, CMs respond
// about the buzz plan inside the people_training text itself).
// The photo `section_key` enum uses 'competitor' (singular); the visits text
// column uses 'competitors' (plural). photoSection maps from the text-section
// key to the photo enum value.
type SectionKey =
  | "good_news"
  | "people_training"
  | "competitors"
  | "display_stock";

const SECTIONS: Array<{
  key: SectionKey;
  photoSection: PhotoWithSection["section_key"];
  label: string;
  icon: string;
  iconBgClass: string;
  titleClass: string;
}> = [
  {
    key: "good_news",
    photoSection: "good_news",
    label: "Good News",
    icon: "🎉",
    iconBgClass: "bg-[var(--color-section-amber-bg)]",
    titleClass: "text-[var(--color-tc-600)]",
  },
  {
    key: "people_training",
    photoSection: "people_training",
    label: "People & Training",
    icon: "👥",
    iconBgClass: "bg-[var(--color-section-teal-bg)]",
    titleClass: "text-[var(--color-section-teal-fg)]",
  },
  {
    key: "competitors",
    photoSection: "competitor",
    label: "Competitor Insights",
    icon: "🔍",
    iconBgClass: "bg-[var(--color-section-blue-bg)]",
    titleClass: "text-[var(--color-tier-t1-fg)]",
  },
  {
    key: "display_stock",
    photoSection: "display_stock",
    label: "Display & Stock",
    icon: "📦",
    iconBgClass: "bg-[var(--color-section-green-bg)]",
    titleClass: "text-[var(--color-tier-t2-fg)]",
  },
];

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Sections the intel brief can deep-link to via ?hl= — the 4 text-section
// cards plus the Follow-ups card.
const HL_SECTIONS = new Set([
  "good_news",
  "people_training",
  "competitors",
  "display_stock",
  "follow_up",
]);

export default function VisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; hl?: string }>;
}) {
  const { id } = use(params);
  const sp = use(searchParams);
  const fromIntel = sp.from === "intel";
  // ?hl=<section> from the intel brief — highlight + scroll to that section.
  const hlSection = sp.hl && HL_SECTIONS.has(sp.hl) ? sp.hl : null;
  const router = useRouter();
  const [data, setData] = useState<VisitPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [editingCMs, setEditingCMs] = useState(false);
  const [marketCMs, setMarketCMs] = useState<MarketCM[] | null>(null);
  const [pendingCoIds, setPendingCoIds] = useState<Set<number>>(new Set());
  const [savingCMs, setSavingCMs] = useState(false);
  const [editingTraining, setEditingTraining] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  useSwipeBack();

  useEffect(() => {
    (async () => {
      const td = await initTelegram();
      if (!td) { setError("Open this from inside Telegram."); return; }
      setInitData(td);
      const res = await fetch(`/api/m/visit/${id}`, {
        headers: { Authorization: `tma ${td}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setData(await res.json());
    })().catch((e) => setError(String(e)));
  }, [id]);

  // Deep-link from bot's Done message: /m/visit/{id}#training opens the
  // training editor automatically. Hash is cleared so a refresh doesn't
  // re-trigger.
  useEffect(() => {
    if (!data) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#training") return;
    if (!data.canEditTraining) return;
    setEditingTraining(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, [data]);

  // Deep-link from the intel brief: ?hl=<section> scrolls the matching
  // section card into view once the visit has rendered.
  useEffect(() => {
    if (!data || !hlSection) return;
    document
      .getElementById(`hl-${hlSection}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data, hlSection]);

  function openCMEditor() {
    if (!data || !initData) return;
    setPendingCoIds(new Set(data.visit.cms.filter((c) => c.role === 'co').map((c) => c.telegram_id)));
    setEditingCMs(true);
    if (marketCMs === null) {
      fetch(`/api/m/filter-options`, { headers: { Authorization: `tma ${initData}` } })
        .then((r) => r.json())
        .then((j) => setMarketCMs(j.cms ?? []))
        .catch(() => setMarketCMs([]));
    }
  }

  function toggleCoCM(tgId: number) {
    setPendingCoIds((curr) => {
      const next = new Set(curr);
      if (next.has(tgId)) next.delete(tgId); else next.add(tgId);
      return next;
    });
  }

  async function saveCoCMs() {
    if (!initData) return;
    setSavingCMs(true);
    try {
      const res = await fetch(`/api/m/visit/${id}/co-cms`, {
        method: "PATCH",
        headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
        body: JSON.stringify({ co_cm_telegram_ids: Array.from(pendingCoIds) }),
      });
      if (res.ok) {
        // Refetch visit to get updated CMs
        const fresh = await fetch(`/api/m/visit/${id}`, { headers: { Authorization: `tma ${initData}` } });
        if (fresh.ok) setData(await fresh.json());
        setEditingCMs(false);
      }
    } finally {
      setSavingCMs(false);
    }
  }

  async function refetchVisit() {
    if (!initData) return;
    const fresh = await fetch(`/api/m/visit/${id}`, { headers: { Authorization: `tma ${initData}` } });
    if (fresh.ok) setData(await fresh.json());
  }

  // CM taps "Mark as seen" on the AM feedback banner → record the ack, then
  // refetch so review_ack_at reflects the saved state.
  async function acknowledgeReview() {
    if (!initData || acking) return;
    setAcking(true);
    try {
      const res = await fetch(`/api/m/visit/${id}/ack-review`, {
        method: "POST",
        headers: { Authorization: `tma ${initData}` },
      });
      if (res.ok) await refetchVisit();
    } finally {
      setAcking(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-400">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    );
  }

  const { visit, photoUrls, canEditCoCMs, canEditTraining, canDelete } = data;

  async function handleDelete() {
    if (!initData || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/m/visit/${id}`, {
        method: "DELETE",
        headers: { Authorization: `tma ${initData}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error ?? `Failed (${res.status})`);
        return;
      }
      router.replace(`/m/store/${visit.store_id}`);
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }
  const photosWithSection: PhotoWithSection[] = data.photos ?? [];
  const lead = visit.cms.find((c) => c.role === 'lead');
  const cos = visit.cms.filter((c) => c.role === 'co');
  const engagedPeople = visit.engaged_people ?? [];
  const followUps = visit.follow_ups ?? [];
  const openFollowUps = followUps.filter((f) => f.status === 'open');

  // Build a lightbox index map keyed by storage_path so any thumb (inline or
  // "Other photos") opens the same flat photoUrls array at the right index.
  const lightboxIndexByPath = new Map<string, number>();
  photosWithSection.forEach((p, i) => lightboxIndexByPath.set(p.storage_path, i));

  // AM review feedback rollup for the banner (boxed fixes + comments across all
  // photos on this visit). hasFeedback gates the whole banner.
  const fixCount = photosWithSection.reduce((n, p) => n + p.annotations.length, 0);
  const commentCount = photosWithSection.reduce((n, p) => n + p.comments.length, 0);
  const hasFeedback = fixCount + commentCount > 0;
  const feedbackSummary = [
    fixCount > 0 ? `${fixCount} boxed fix${fixCount !== 1 ? "es" : ""}` : null,
    commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ");

  // Group photos by photoSection enum value. Anything not matching a known
  // section (NULL or legacy values like 'staff') falls into "other".
  const photosBySection = new Map<string, PhotoWithSection[]>();
  const otherPhotos: PhotoWithSection[] = [];
  for (const p of photosWithSection) {
    const key = p.section_key;
    if (
      key === 'good_news' ||
      key === 'people_training' ||
      key === 'competitor' ||
      key === 'display_stock'
    ) {
      const arr = photosBySection.get(key) ?? [];
      arr.push(p);
      photosBySection.set(key, arr);
    } else {
      // 'follow_up' (legacy section) + NULL + unknown values all fall through.
      otherPhotos.push(p);
    }
  }

  // Render a section card only if it has text OR has tagged photos.
  // Legacy buzz_plan column surfaces inside the People & Training card.
  const visibleSections = SECTIONS.filter((s) => {
    if (visit[s.key]) return true;
    if (s.photoSection && (photosBySection.get(s.photoSection)?.length ?? 0) > 0) return true;
    if (s.key === 'people_training' && visit.buzz_plan) return true;
    return false;
  });

  return (
    <main className="min-h-screen pb-12">
      {/* Header */}
      <header className="bg-white border-b border-ink-100 px-4 pt-4 pb-4">
        {fromIntel ? (
          <button
            onClick={() => router.back()}
            className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-3"
          >
            ‹ Daily Brief
          </button>
        ) : (
          <Link
            href={`/m/store/${visit.store_id}`}
            className="text-xs text-ink-300 font-medium flex items-center gap-1 mb-3"
          >
            ‹ {visit.store_name}
          </Link>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-ink-700 leading-tight">
              {fmtDate(visit.visit_date)}
              {visit.edited_at && (
                <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-ink-300">edited</span>
              )}
            </h1>
            {visit.grade && (
              <div className="mt-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${GRADE_STYLES[visit.grade].pill}`}
                >
                  {GRADE_STYLES[visit.grade].label}
                </span>
                {visit.grade_comments && (
                  <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-400">
                    {visit.grade_comments}
                  </p>
                )}
              </div>
            )}
            {/* CM list */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {lead && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-100)] px-2 py-0.5 text-[11px] font-bold">
                  <span className="text-[9px] uppercase tracking-wider opacity-70">Lead</span> {lead.name}
                </span>
              )}
              {cos.map((c) => (
                <span key={c.telegram_id} className="inline-flex items-center rounded-full bg-ink-100 text-ink-500 px-2 py-0.5 text-[11px] font-semibold">
                  {c.name}
                </span>
              ))}
              {canEditCoCMs && (
                <button
                  onClick={openCMEditor}
                  className="rounded-full border border-dashed border-ink-200 px-2 py-0.5 text-[11px] font-semibold text-ink-400"
                >
                  + Edit co-CMs
                </button>
              )}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1.5">
            <Link
              href={`/m/visit/${visit.id}/edit`}
              className="rounded-xl bg-ink-50 px-3 py-1.5 text-[11px] font-bold text-ink-400 active:bg-ink-100"
            >
              Edit
            </Link>
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-xl px-3 py-1.5 text-[11px] font-bold text-rose-600 active:bg-rose-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </header>

      {/* AM feedback banner — only when there's review feedback to see. Drives
          discoverability (open a flagged photo) + lets the CM mark it seen. */}
      {hasFeedback && (
        <div className="mx-3.5 mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
          {visit.review_ack_at ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-700">
              <span>✓</span> You&apos;ve seen this feedback
            </p>
          ) : (
            <>
              <p className="text-[13px] font-extrabold text-amber-800">
                ⬚ Your AM reviewed this visit
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700">
                {feedbackSummary} — open a flagged photo (amber badge) to see what to fix.
              </p>
              <button
                type="button"
                onClick={acknowledgeReview}
                disabled={acking}
                className="mt-2.5 rounded-full bg-amber-500 px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-50"
              >
                {acking ? "Saving…" : "Mark as seen"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Sections — each card includes its text + inline photos for that section */}
      <div className="space-y-2 px-3.5 mt-4">
        {visibleSections.length === 0 && otherPhotos.length === 0 ? (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 text-center">
            <p className="text-sm text-ink-300">No notes were added for this visit.</p>
          </div>
        ) : (
          visibleSections.map((s) => {
            const sectionPhotos = s.photoSection
              ? (photosBySection.get(s.photoSection) ?? [])
              : [];
            return (
              <div
                key={s.key}
                id={`hl-${s.key}`}
                className={`rounded-[18px] border p-4 ${
                  hlSection === s.key ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-white"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${s.iconBgClass}`}>
                    {s.icon}
                  </span>
                  <span className={`text-[10px] font-extrabold uppercase tracking-wider ${s.titleClass}`}>
                    {s.label}
                  </span>
                </div>
                {visit[s.key] && (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-500">
                    {visit[s.key] as string}
                  </p>
                )}
                {s.key === 'people_training' && visit.buzz_plan && (
                  <div className="mt-3 rounded-lg border-l-2 border-[#5B2DB5] bg-[var(--color-section-purple-bg)]/40 px-3 py-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#5B2DB5] mb-1">
                      ⚡ Buzz Plan
                    </p>
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-500">
                      {visit.buzz_plan}
                    </p>
                  </div>
                )}
                {sectionPhotos.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto -mx-1 px-1 scrollbar-hide">
                    {sectionPhotos.map((p) => {
                      const idx = lightboxIndexByPath.get(p.storage_path) ?? 0;
                      const url = p.url;
                      if (!url) return null;
                      const fb = p.annotations.length + p.comments.length;
                      return (
                        <button
                          key={p.storage_path}
                          type="button"
                          onClick={() => setLightboxIndex(idx)}
                          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-100"
                        >
                          <Image
                            src={url}
                            alt={s.label}
                            fill
                            className="object-cover"
                            sizes="80px"
                            unoptimized
                          />
                          {fb > 0 && (
                            <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black shadow">
                              {fb}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Follow-ups card */}
        <div
          id="hl-follow_up"
          className={`rounded-[18px] border p-4 ${
            hlSection === "follow_up" ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-white"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-section-pink-bg)] text-sm">
                ✅
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C0185A]">
                {`Follow-ups (${openFollowUps.length} open)`}
              </span>
            </div>
            <Link
              href={`/m/visit/${visit.id}/followup`}
              className="rounded-full bg-[var(--color-section-pink-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[#C0185A]"
            >
              + Add
            </Link>
          </div>
          {followUps.length === 0 ? (
            <p className="text-[12px] italic text-ink-300">No follow-ups for this visit.</p>
          ) : (
            <ul className="space-y-1.5">
              {followUps.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-[13px]">
                  <span className="mt-0.5 text-ink-300">
                    {f.status === 'done' ? '☑' : '☐'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`leading-relaxed ${f.status === 'done' ? 'text-ink-300 line-through' : 'text-ink-700'}`}>
                      {f.title}
                    </p>
                    {(f.due_date || f.notes) && (
                      <p className="text-[11px] text-ink-300 mt-0.5">
                        {f.due_date && <span>Due {f.due_date}</span>}
                        {f.due_date && f.notes && <span> · </span>}
                        {f.notes && <span>{f.notes}</span>}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Other photos (untagged + legacy) */}
        {otherPhotos.length > 0 && (
          <div className="rounded-[18px] border border-ink-100 bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-sm">
                📸
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-400">
                Other photos
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 scrollbar-hide">
              {otherPhotos.map((p) => {
                const idx = lightboxIndexByPath.get(p.storage_path) ?? 0;
                const url = p.url;
                if (!url) return null;
                const fb = p.annotations.length + p.comments.length;
                return (
                  <button
                    key={p.storage_path}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-100"
                  >
                    <Image
                      src={url}
                      alt="Photo"
                      fill
                      className="object-cover"
                      sizes="80px"
                      unoptimized
                    />
                    {fb > 0 && (
                      <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-black shadow">
                        {fb}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* People & engagements */}
      {(engagedPeople.length > 0 || canEditTraining) && (
        <div className="px-3.5 mt-2">
          <div className="rounded-[18px] border border-ink-100 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-section-teal-bg)] text-sm">
                  👥
                </span>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--color-section-teal-fg)]">
                  People &amp; engagements
                </span>
              </div>
              {canEditTraining && (
                <button
                  onClick={() => setEditingTraining(true)}
                  className="rounded-full bg-[var(--color-section-teal-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--color-section-teal-fg)]"
                >
                  {engagedPeople.length > 0 ? "Edit" : "+ Add people"}
                </button>
              )}
            </div>
            {engagedPeople.length === 0 ? (
              <p className="text-[12px] italic text-ink-300">No one logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {engagedPeople.map((person) => (
                  <li key={person.id} className="rounded-xl border border-ink-100 px-3 py-2.5">
                    <p className="text-[13px] font-bold text-ink-700">{person.name}</p>
                    {person.update_text && (
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-500">
                        {person.update_text}
                      </p>
                    )}
                    {person.trainings.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {person.trainings.map((t, i) => (
                          <div key={i} className="rounded-lg bg-[var(--color-ink-50)] px-2.5 py-1.5">
                            <span className="inline-block rounded-full bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-100)] px-2 py-0.5 text-[11px] font-semibold">
                              🎓 {t.product_name}
                            </span>
                            {t.response && (
                              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-500">
                                {t.response}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {!person.update_text && person.trainings.length === 0 && (
                      <p className="mt-1 text-[12px] italic text-ink-300">No details yet</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Engagement editor (shared component — also used by /edit page) */}
      {initData && (
        <EngagementEditor
          open={editingTraining}
          onClose={() => setEditingTraining(false)}
          onSaved={() => { refetchVisit().catch(() => {}); }}
          visitId={id}
          initData={initData}
          people={engagedPeople}
        />
      )}


      {/* Edit co-CMs sheet */}
      {editingCMs && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setEditingCMs(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl px-5 pt-5 pb-8 shadow-xl max-h-[80vh] flex flex-col">
            <div className="w-8 h-1 bg-ink-200 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-extrabold text-ink-700 mb-1">Edit co-CMs</h2>
            <p className="text-[11px] text-ink-300 mb-3">Tap to toggle. The lead CM ({lead?.name}) cannot be removed here.</p>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {marketCMs === null ? (
                <p className="text-center text-sm text-ink-300 py-6">Loading…</p>
              ) : marketCMs.length === 0 ? (
                <p className="text-center text-sm text-ink-300 py-6">No other CMs in your market.</p>
              ) : (
                <ul className="space-y-1.5">
                  {marketCMs
                    .filter((c) => c.telegram_id !== lead?.telegram_id)
                    .map((c) => {
                      const on = pendingCoIds.has(c.telegram_id);
                      return (
                        <li key={c.telegram_id}>
                          <button
                            onClick={() => toggleCoCM(c.telegram_id)}
                            className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                              on ? "bg-[var(--color-tc-50)] text-[var(--color-tc-600)] border border-[var(--color-tc-200)]" : "bg-ink-50 text-ink-700 border border-transparent"
                            }`}
                          >
                            <span>{c.name}</span>
                            <span className="text-base">{on ? "✓" : ""}</span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditingCMs(false)}
                className="flex-1 rounded-xl py-3 text-sm font-bold bg-ink-100 text-ink-500"
              >
                Cancel
              </button>
              <button
                onClick={saveCoCMs}
                disabled={savingCMs}
                className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "var(--color-tc-600)" }}
              >
                {savingCMs ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => !deleting && setConfirmDelete(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl px-5 pt-5 pb-8 shadow-xl">
            <div className="w-8 h-1 bg-ink-200 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-extrabold text-ink-700 mb-1">Delete this visit?</h2>
            <p className="text-[12px] text-ink-400 leading-relaxed mb-4">
              This will remove the visit at <strong>{visit.store_name}</strong> on{" "}
              {fmtDate(visit.visit_date)}, all {photoUrls.length}{" "}
              {photoUrls.length === 1 ? "photo" : "photos"}, follow-ups, and training records.
              This can&apos;t be undone.
            </p>
            {deleteError && (
              <p className="text-[12px] text-rose-600 mb-3">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-sm font-bold bg-ink-100 text-ink-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-sm font-bold bg-rose-600 text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Lightbox — photo + read-only AM review feedback (boxed fixes + comments) */}
      {lightboxIndex !== null && (() => {
        const active = photosWithSection[lightboxIndex];
        const anns = active?.annotations ?? [];
        const comments = active?.comments ?? [];
        const hasFeedback = anns.length > 0 || comments.length > 0;
        return (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setLightboxIndex(null)}
            className="fixed inset-0 z-50 flex flex-col bg-black/90"
          >
            {/* Image + box overlay. A plain <img> in an inline-block wrapper so the
                wrapper shrink-wraps the rendered photo and the % boxes align. */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrls[lightboxIndex]}
                  alt={`Photo ${lightboxIndex + 1}`}
                  draggable={false}
                  className={`block max-w-full object-contain ${hasFeedback ? "max-h-[62vh]" : "max-h-[88vh]"}`}
                />
                {anns.map((a, i) => (
                  <div
                    key={a.id}
                    className="pointer-events-none absolute rounded-sm border-2 border-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                    style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}
                  >
                    <span className="absolute -left-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold text-black">
                      {i + 1}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
                className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white"
              >
                Close
              </button>
            </div>

            {/* Read-only feedback panel — only shown when there's feedback to read. */}
            {hasFeedback && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[34vh] space-y-3 overflow-y-auto rounded-t-2xl bg-white px-4 pb-5 pt-3"
              >
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-600">
                  ⬚ AM Feedback
                </p>
                {anns.length > 0 && (
                  <ul className="space-y-1.5">
                    {anns.map((a, i) => (
                      <li key={a.id} className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold text-black">
                          {i + 1}
                        </span>
                        <p className="text-[13px] leading-relaxed text-ink-700">
                          {a.note || <em className="text-ink-300">No note</em>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {comments.length > 0 && (
                  <ul className="space-y-1.5">
                    {comments.map((c) => (
                      <li key={c.id} className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 text-ink-300">💬</span>
                        <div className="min-w-0">
                          <p className="text-[13px] leading-relaxed text-ink-700">{c.body}</p>
                          <p className="text-[11px] text-ink-300">
                            {c.author_name ?? "—"}
                            {c.created_at ? ` · ${fmtDate(c.created_at.slice(0, 10))}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </main>
  );
}
