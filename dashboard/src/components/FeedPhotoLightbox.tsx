"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { PhotoItem, PhotoComment, PhotoAnnotation } from "@/lib/queries";
import { fmtDate } from "@/lib/visit-shared";

// Lightbox for the Store Updates feed: flip through a visit's photos with ‹ ›
// + ←/→ keys, comment on each, and draw box annotations ("the square thing") to
// flag spots that need fixing. Comments + boxes persist via /api/photos/[id]/…
// Pointer-event based (mouse + touch) so it works on phones — that's why this is
// a separate copy from the store reviewer's mouse-only drag logic.

type DragMode = "draw" | "move" | "resize";
interface DragState {
  mode: DragMode; id: string; corner?: string;
  startX: number; startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function api(url: string, method: string, body: unknown) {
  return fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

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
  // Local copy so added/deleted comments + boxes show immediately without a feed refetch.
  const [local, setLocal] = useState<PhotoItem[]>(photos);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeAnn, setActiveAnn] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ id: string; isNew: boolean; text: string } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const tmpId = useRef(0);

  const photo = local[idx];
  const count = local.length;

  const go = useCallback((delta: number) => {
    setIdx((i) => (i + delta + count) % count);
  }, [count]);

  // Reset transient annotation UI when the open photo changes.
  useEffect(() => { setActiveAnn(null); setComposer(null); }, [idx]);

  // Keyboard: ←/→ navigate, Esc closes (or deselects a box first), ⌫ deletes the
  // selected box. Skip nav while typing in an input/textarea.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || composer) {
        if (e.key === "Escape" && composer) { setComposer(null); }
        return;
      }
      if (e.key === "Escape") { if (activeAnn) setActiveAnn(null); else onClose(); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && activeAnn) { e.preventDefault(); deleteAnn(activeAnn); return; }
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, onClose, activeAnn, composer]);

  // ── helpers ──
  const setAnns = useCallback((photoId: string, fn: (a: PhotoAnnotation[]) => PhotoAnnotation[]) => {
    setLocal((prev) => prev.map((p) => p.id === photoId ? { ...p, annotations: fn(p.annotations) } : p));
  }, []);

  const pct = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width * 100), y: clamp((e.clientY - r.top) / r.height * 100) };
  };

  function capture(e: React.PointerEvent) {
    try { wrapRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }

  // ── annotation drag (pointer = mouse + touch) ──
  function onBgDown(e: React.PointerEvent) {
    if (e.button !== 0 || !photo) return;
    const start = pct(e);
    const tid = `tmp-${tmpId.current++}`;
    setAnns(photo.id, (arr) => [...arr, { id: tid, x: start.x, y: start.y, w: 0, h: 0, note: "", author_name: null, created_at: "" }]);
    setActiveAnn(tid);
    drag.current = { mode: "draw", id: tid, startX: start.x, startY: start.y, orig: { x: start.x, y: start.y, w: 0, h: 0 } };
    capture(e);
  }
  function onBoxDown(e: React.PointerEvent, a: PhotoAnnotation) {
    e.stopPropagation(); if (e.button !== 0) return;
    setActiveAnn(a.id);
    const s = pct(e);
    drag.current = { mode: "move", id: a.id, startX: s.x, startY: s.y, orig: { x: a.x, y: a.y, w: a.w, h: a.h } };
    capture(e);
  }
  function onHandleDown(e: React.PointerEvent, a: PhotoAnnotation, corner: string) {
    e.stopPropagation(); if (e.button !== 0) return;
    setActiveAnn(a.id);
    const s = pct(e);
    drag.current = { mode: "resize", corner, id: a.id, startX: s.x, startY: s.y, orig: { x: a.x, y: a.y, w: a.w, h: a.h } };
    capture(e);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (!d || !photo) return;
    const cur = pct(e); const o = d.orig;
    setAnns(photo.id, (arr) => arr.map((a) => {
      if (a.id !== d.id) return a;
      if (d.mode === "draw") return { ...a, x: Math.min(d.startX, cur.x), y: Math.min(d.startY, cur.y), w: Math.abs(cur.x - d.startX), h: Math.abs(cur.y - d.startY) };
      if (d.mode === "move") return { ...a, x: Math.min(clamp(o.x + (cur.x - d.startX)), 100 - o.w), y: Math.min(clamp(o.y + (cur.y - d.startY)), 100 - o.h) };
      let { x, y, w, h } = o; const r = x + w, b = y + h; const c = d.corner!;
      if (c.includes("w")) { x = Math.min(cur.x, r); w = r - x; }
      if (c.includes("n")) { y = Math.min(cur.y, b); h = b - y; }
      if (c.includes("e")) { w = Math.max(0, cur.x - x); }
      if (c.includes("s")) { h = Math.max(0, cur.y - y); }
      return { ...a, x, y, w, h };
    }));
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current; if (!d || !photo) return;
    drag.current = null;
    try { wrapRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const box = local[idx].annotations.find((a) => a.id === d.id);
    if (d.mode === "draw") {
      // Too small to be intentional → discard.
      if (!box || box.w < 2 || box.h < 2) { setAnns(photo.id, (arr) => arr.filter((a) => a.id !== d.id)); setActiveAnn(null); return; }
      setComposer({ id: d.id, isNew: true, text: "" });
    } else if (box && !box.id.startsWith("tmp-")) {
      api(`/api/photos/${photo.id}/annotations`, "PATCH", { annotationId: box.id, x: box.x, y: box.y, w: box.w, h: box.h });
    }
  }

  function openComposer(annId: string) {
    const box = photo?.annotations.find((a) => a.id === annId); if (!box) return;
    setActiveAnn(annId);
    setComposer({ id: annId, isNew: false, text: box.note || "" });
  }

  async function composerSave() {
    if (!composer || !photo) return;
    const text = composer.text.trim();
    if (!text) return composerCancel();
    if (composer.isNew) {
      const box = local[idx].annotations.find((a) => a.id === composer.id); if (!box) return;
      const res = await api(`/api/photos/${photo.id}/annotations`, "POST", { x: box.x, y: box.y, w: box.w, h: box.h, note: text });
      if (res.ok) {
        const saved = await res.json() as PhotoAnnotation;
        setAnns(photo.id, (arr) => arr.map((a) => a.id === composer.id ? saved : a));
        setActiveAnn(saved.id);
      }
    } else {
      api(`/api/photos/${photo.id}/annotations`, "PATCH", { annotationId: composer.id, note: text });
      setAnns(photo.id, (arr) => arr.map((a) => a.id === composer.id ? { ...a, note: text } : a));
    }
    setComposer(null);
  }
  function composerCancel() {
    // A brand-new box with no note saved → drop it.
    if (composer?.isNew && photo) { setAnns(photo.id, (arr) => arr.filter((a) => a.id !== composer.id)); setActiveAnn(null); }
    setComposer(null);
  }
  function deleteAnn(annId: string) {
    if (!photo) return;
    if (!annId.startsWith("tmp-")) api(`/api/photos/${photo.id}/annotations`, "DELETE", { annotationId: annId });
    setAnns(photo.id, (arr) => arr.filter((a) => a.id !== annId));
    setActiveAnn(null); setComposer(null);
  }

  // ── comments ──
  async function addComment() {
    const body = input.trim();
    if (!body || !photo || busy) return;
    setBusy(true);
    try {
      const res = await api(`/api/photos/${photo.id}/comments`, "POST", { body });
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
    await api(`/api/photos/${photo.id}/comments`, "DELETE", { commentId });
  }

  if (!photo) return null;
  const anns = photo.annotations;

  return (
    <div className="review-overlay" onClick={onClose}>
      {count > 1 && (
        <button className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
      )}

      <div className="review-stage" onClick={(e) => e.stopPropagation()}>
        <div
          className="review-imgwrap"
          ref={wrapRef}
          style={{ touchAction: "none" }}
          onPointerDown={onBgDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="review-img" src={photo.url} alt={`Photo ${idx + 1}`} draggable={false} />
          {anns.map((a, i) => (
            <div
              key={a.id}
              className={`ann-box${activeAnn === a.id ? " active" : ""}`}
              style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}
              onPointerDown={(e) => onBoxDown(e, a)}
              onDoubleClick={(e) => { e.stopPropagation(); openComposer(a.id); }}
            >
              <div className="ann-num">{i + 1}</div>
              <div className="ann-handle nw" onPointerDown={(e) => onHandleDown(e, a, "nw")} />
              <div className="ann-handle ne" onPointerDown={(e) => onHandleDown(e, a, "ne")} />
              <div className="ann-handle sw" onPointerDown={(e) => onHandleDown(e, a, "sw")} />
              <div className="ann-handle se" onPointerDown={(e) => onHandleDown(e, a, "se")} />
            </div>
          ))}
          <div className="review-hint">
            {activeAnn ? "Box selected · drag to move · double-tap to edit · ⌫ delete" : "Drag a box around anything to flag it"}
          </div>
        </div>
        <div className="lb-context">
          <span className="lb-count">{idx + 1} / {count}</span>
          <span>{context}</span>
        </div>
      </div>

      <div className="review-panel" onClick={(e) => e.stopPropagation()}>
        <div className="review-panel-head">
          <div className="review-panel-title">Review</div>
          <div className="review-panel-sub">
            {anns.length} boxed fix{anns.length !== 1 ? "es" : ""} · {photo.comments.length} comment{photo.comments.length !== 1 ? "s" : ""}
            {photo.section_key ? ` · ${photo.section_key.replace(/_/g, " ")}` : ""}
          </div>
        </div>

        <div className="review-body">
          {anns.length > 0 && <div className="review-sechead">⬚ Boxed fixes</div>}
          {anns.map((a, i) => (
            <div key={a.id} className="review-note" onClick={() => openComposer(a.id)}>
              <div className="review-note-num">{i + 1}</div>
              <div className="review-note-txt">{a.note || <em style={{ color: "var(--color-ink-300)" }}>No note yet</em>}</div>
              <button className="review-note-del" onClick={(e) => { e.stopPropagation(); deleteAnn(a.id); }} title="Delete">✕</button>
            </div>
          ))}

          {photo.comments.length > 0 && <div className="review-sechead">💬 Comments</div>}
          {photo.comments.map((c) => (
            <div key={c.id} className="review-note" style={{ cursor: "default" }}>
              <div className="review-note-num cmt">•</div>
              <div className="review-note-txt">
                {c.body}
                <small>{c.author_name ?? "—"}{c.created_at ? ` · ${fmtDate(c.created_at.slice(0, 10))}` : ""}</small>
              </div>
              <button className="review-note-del" onClick={() => delComment(c.id)} title="Delete">✕</button>
            </div>
          ))}

          {anns.length === 0 && photo.comments.length === 0 && (
            <div className="review-tip"><b>How this works</b>Drag a box over any spot that needs fixing, then type what to fix. Or add a general comment below.</div>
          )}
        </div>

        <div className="review-addcomment">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
            placeholder="Add a comment…"
          />
          <button onClick={addComment} disabled={busy}>Post</button>
        </div>
      </div>

      <button className="lightbox-close" onClick={onClose}>Close</button>
      {count > 1 && (
        <button className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
      )}

      {composer && (
        <div
          className="ann-composer"
          style={{ left: 16, right: 16, bottom: 16, top: "auto", width: "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ann-composer-head">⬚ Mark a fix</div>
          <textarea
            autoFocus
            value={composer.text}
            onChange={(e) => setComposer((c) => c ? { ...c, text: e.target.value } : c)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composerSave(); }
              if (e.key === "Escape") { e.preventDefault(); composerCancel(); }
            }}
            placeholder="What should the CM fix in this area?"
          />
          <div className="ann-composer-btns">
            {!composer.isNew && <button className="del" onClick={() => deleteAnn(composer.id)}>Delete</button>}
            <button className="cancel" onClick={composerCancel}>Cancel</button>
            <button className="save" onClick={composerSave}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
