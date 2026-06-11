"use client";

import { useEffect, useRef, useState } from "react";
import FeedPhotoLightbox from "@/components/FeedPhotoLightbox";
import type { PhotoItem } from "@/lib/queries";

// Weekly report drawer: a store's photo history grouped by ISO week (newest
// first, capped server-side at 8 weeks). Clicking a photo opens the shared
// FeedPhotoLightbox — same comments + annotations wiring as the visits feed.

interface WeekPhotos {
  weekStart: string; // Monday ISO
  photos: PhotoItem[];
}

interface Props {
  store: { id: string; name: string } | null;
  onClose: () => void;
}

const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekLabel(weekStartISO: string): string {
  const s = new Date(weekStartISO + "T00:00:00");
  const e = new Date(s); e.setDate(s.getDate() + 6);
  if (s.getMonth() === e.getMonth()) {
    return `${s.getDate()}–${e.getDate()} ${MONS[e.getMonth()]} ${e.getFullYear()}`;
  }
  return `${s.getDate()} ${MONS[s.getMonth()]} – ${e.getDate()} ${MONS[e.getMonth()]} ${e.getFullYear()}`;
}

export default function StorePhotosDrawer({ store, onClose }: Props) {
  const [weeks, setWeeks] = useState<WeekPhotos[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<{ photos: PhotoItem[]; index: number; context: string } | null>(null);
  const prevId = useRef<string | null>(null);

  const isOpen = store !== null;

  useEffect(() => {
    if (!store) return;
    if (store.id === prevId.current) return;
    prevId.current = store.id;
    setWeeks([]);
    setHasOlder(false);
    setLoading(true);
    fetch(`/api/stores/${store.id}/photos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setWeeks(d?.weeks ?? []); setHasOlder(Boolean(d?.hasOlder)); })
      .finally(() => setLoading(false));
  }, [store]);

  // Escape closes the drawer — unless the lightbox is open (it handles its own).
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !lightbox) onClose(); }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, lightbox]);

  const totalPhotos = weeks.reduce((acc, w) => acc + w.photos.length, 0);

  return (
    <>
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520, maxWidth: "100vw", zIndex: 260,
          background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
          boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.10)" : "none",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-ink-400)", marginBottom: 4 }}>
                📸 Store Photos
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2 }}>
                {store?.name}
              </div>
              {!loading && (
                <div style={{ fontSize: 13, color: "var(--color-ink-500)", marginTop: 4 }}>
                  {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} · last {weeks.length} week{weeks.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
            <button
              onClick={onClose} aria-label="Close store photos drawer"
              style={{
                padding: "4px 8px", borderRadius: 8, background: "var(--color-ink-50)",
                border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1,
                color: "var(--color-ink-500)", flexShrink: 0,
              }}
            >✕</button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
          {loading && <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>Loading…</p>}
          {!loading && weeks.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>No photos logged for this store yet.</p>
          )}
          {!loading && weeks.map((w) => (
            <div key={w.weekStart} style={{ marginBottom: 18 }}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 6,
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em", color: "var(--color-ink-300)", marginBottom: 8,
              }}>
                {weekLabel(w.weekStart)}
                <span style={{
                  background: "var(--color-ink-100)", color: "var(--color-ink-500)",
                  borderRadius: 999, padding: "1px 8px", fontSize: 10.5,
                }}>{w.photos.length}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8 }}>
                {w.photos.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => setLightbox({
                      photos: w.photos,
                      index: i,
                      context: `${store?.name ?? ""} · ${weekLabel(w.weekStart)}`,
                    })}
                    style={{
                      position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden",
                      border: "1px solid var(--color-border)", cursor: "pointer", padding: 0, background: "none",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {p.comments.length > 0 && (
                      <span style={{
                        position: "absolute", bottom: 4, right: 4,
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                        background: "rgba(0,0,0,0.6)", color: "#fff",
                      }}>💬 {p.comments.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!loading && hasOlder && (
            <p style={{ fontSize: 12, color: "var(--color-ink-300)" }}>
              Older photos exist beyond the last 8 weeks.
            </p>
          )}
        </div>
      </div>

      {/* Photo lightbox — wrapped so it stacks above this drawer (z 260). */}
      {lightbox && (
        <div style={{ position: "fixed", inset: 0, zIndex: 320 }}>
          <FeedPhotoLightbox
            photos={lightbox.photos}
            startIndex={lightbox.index}
            context={lightbox.context}
            onClose={() => setLightbox(null)}
          />
        </div>
      )}
    </>
  );
}
