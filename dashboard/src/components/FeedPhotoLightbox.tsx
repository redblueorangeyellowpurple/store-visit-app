"use client";

import { useEffect, useState, useCallback } from "react";
import { PhotoItem, PhotoComment } from "@/lib/queries";
import { fmtDate } from "@/lib/visit-shared";

// Lightbox for the Store Updates feed: flip through a visit's photos with ‹ ›
// + ←/→ keys, and comment on each photo. Comments persist via /api/photos/[id]/comments.
// Annotations (box-drawing) + grading + reports live on the full reviewer page
// (/visits/store/[id]); this is the lightweight in-feed review surface.

export default function FeedPhotoLightbox({
  photos,
  startIndex,
  context,
  onClose,
}: {
  photos: PhotoItem[];
  startIndex: number;
  context: string; // e.g. "Challenger @ ION · Ng Zhi Yong · 3 Jun"
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  // Local copy so added/deleted comments show immediately without a feed refetch.
  const [local, setLocal] = useState<PhotoItem[]>(photos);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const photo = local[idx];
  const count = local.length;

  const go = useCallback((delta: number) => {
    setIdx((i) => (i + delta + count) % count);
  }, [count]);

  // Keyboard: ←/→ navigate, Esc closes. Skip nav when typing in the comment box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  async function addComment() {
    const body = input.trim();
    if (!body || !photo || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/photos/${photo.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const c: PhotoComment = await res.json();
        setLocal((prev) => prev.map((p) => p.id === photo.id ? { ...p, comments: [...p.comments, c] } : p));
        setInput("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function delComment(commentId: string) {
    if (!photo) return;
    setLocal((prev) => prev.map((p) => p.id === photo.id ? { ...p, comments: p.comments.filter((c) => c.id !== commentId) } : p));
    await fetch(`/api/photos/${photo.id}/comments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId }),
    });
  }

  if (!photo) return null;

  return (
    <div className="review-overlay" onClick={onClose}>
      {count > 1 && (
        <button className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
      )}

      <div className="review-stage" onClick={(e) => e.stopPropagation()}>
        <div className="review-imgwrap" style={{ cursor: "default" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="review-img" src={photo.url} alt={`Photo ${idx + 1}`} draggable={false} />
        </div>
        <div className="lb-context">
          <span className="lb-count">{idx + 1} / {count}</span>
          <span>{context}</span>
        </div>
      </div>

      <div className="review-panel" onClick={(e) => e.stopPropagation()}>
        <div className="review-panel-head">
          <div className="review-panel-title">Comments</div>
          <div className="review-panel-sub">
            {photo.comments.length === 0
              ? "No comments yet"
              : `${photo.comments.length} comment${photo.comments.length !== 1 ? "s" : ""}`}
            {photo.section_key ? ` · ${photo.section_key.replace(/_/g, " ")}` : ""}
          </div>
        </div>

        <div className="review-body">
          {photo.comments.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: 6 }}>
              Add a note about this photo — it stays attached to it.
            </p>
          ) : (
            photo.comments.map((c) => (
              <div key={c.id} className="review-note" style={{ cursor: "default" }}>
                <div className="review-note-num cmt">💬</div>
                <div className="review-note-txt">
                  {c.body}
                  <small>{c.author_name ?? "—"}{c.created_at ? ` · ${fmtDate(c.created_at.slice(0, 10))}` : ""}</small>
                </div>
                <button className="review-note-del" onClick={() => delComment(c.id)} title="Delete">✕</button>
              </div>
            ))
          )}
        </div>

        <div className="review-addcomment">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
            placeholder="Add a comment…"
            autoFocus
          />
          <button onClick={addComment} disabled={busy}>Post</button>
        </div>
      </div>

      <button className="lightbox-close" onClick={onClose}>Close</button>
      {count > 1 && (
        <button className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
      )}
    </div>
  );
}
