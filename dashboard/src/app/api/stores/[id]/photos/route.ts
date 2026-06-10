import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isoDate, mondayOf } from "@/lib/weekly";
import type { PhotoAnnotation, PhotoComment, PhotoItem } from "@/lib/queries";

// GET /api/stores/[id]/photos — a store's photos from locked visits, grouped by
// ISO week (Monday-keyed), newest week first, capped at MAX_WEEKS. `hasOlder`
// flags that older weeks exist beyond the cap. Consumed by StorePhotosDrawer.

const MAX_WEEKS = 8;

// Signed-URL helper — replicates the signPhotoUrls pattern in lib/queries.ts,
// kept local so this route doesn't couple to the dashboard query layer.
async function signPhotoPaths(paths: string[], ttlSec: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data, error } = await supabase.storage.from("sva-photos").createSignedUrls(paths, ttlSec);
  if (error || !data) return map;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data as any[]).forEach((d, i) => { if (d?.signedUrl) map.set(paths[i], d.signedUrl as string); });
  return map;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { id } = await params;

  const { data: photoRows, error } = await supabase
    .from("visit_photos")
    .select("id, storage_path, section_key, review_grade, created_at, visits!inner(store_id, visit_date, is_locked)")
    .eq("visits.store_id", id)
    .eq("visits.is_locked", true);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    storage_path: string;
    section_key: string | null;
    review_grade: number | null;
    created_at: string;
    visit_date: string;
  };
  const rows: Row[] = ((photoRows ?? []) as unknown[]).map((p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = p as any;
    const visit = Array.isArray(r.visits) ? r.visits[0] : r.visits;
    return {
      id: r.id as string,
      storage_path: r.storage_path as string,
      section_key: (r.section_key ?? null) as string | null,
      review_grade: (r.review_grade ?? null) as number | null,
      created_at: r.created_at as string,
      visit_date: (visit?.visit_date ?? "") as string,
    };
  }).filter((r) => r.visit_date);

  // Group by ISO week (Monday), newest first, cap at MAX_WEEKS.
  const byWeek = new Map<string, Row[]>();
  for (const r of rows) {
    const wk = isoDate(mondayOf(new Date(r.visit_date + "T00:00:00")));
    const list = byWeek.get(wk) ?? [];
    list.push(r);
    byWeek.set(wk, list);
  }
  const weekStarts = Array.from(byWeek.keys()).sort().reverse();
  const capped = weekStarts.slice(0, MAX_WEEKS);
  const hasOlder = weekStarts.length > MAX_WEEKS;

  const cappedRows = capped.flatMap((wk) => byWeek.get(wk)!);
  // 1h TTL so a long review session doesn't 403 mid-way.
  const signedMap = await signPhotoPaths(cappedRows.map((r) => r.storage_path), 3600);

  // Comments + annotations so the lightbox can show + extend them.
  const photoIds = cappedRows.map((r) => r.id);
  const commentsByPhoto = new Map<string, PhotoComment[]>();
  const annotationsByPhoto = new Map<string, PhotoAnnotation[]>();
  if (photoIds.length > 0) {
    const [cRes, aRes] = await Promise.all([
      supabase.from("photo_comments")
        .select("id, photo_id, body, author_name, created_at")
        .in("photo_id", photoIds).order("created_at"),
      supabase.from("photo_annotations")
        .select("id, photo_id, x, y, w, h, note, author_name, created_at")
        .in("photo_id", photoIds).order("created_at"),
    ]);
    for (const r of (cRes.data ?? []) as Array<PhotoComment & { photo_id: string }>) {
      const list = commentsByPhoto.get(r.photo_id) ?? [];
      list.push({ id: r.id, body: r.body, author_name: r.author_name, created_at: r.created_at });
      commentsByPhoto.set(r.photo_id, list);
    }
    for (const r of (aRes.data ?? []) as Array<PhotoAnnotation & { photo_id: string }>) {
      const list = annotationsByPhoto.get(r.photo_id) ?? [];
      list.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, note: r.note, author_name: r.author_name, created_at: r.created_at });
      annotationsByPhoto.set(r.photo_id, list);
    }
  }

  const weeks = capped.map((weekStart) => {
    const photos: PhotoItem[] = byWeek.get(weekStart)!
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date) || a.created_at.localeCompare(b.created_at))
      .map((r) => ({
        id: r.id,
        url: signedMap.get(r.storage_path) ?? "",
        section_key: r.section_key,
        grade: r.review_grade,
        comments: commentsByPhoto.get(r.id) ?? [],
        annotations: annotationsByPhoto.get(r.id) ?? [],
      }))
      .filter((p) => p.url);
    return { weekStart, photos };
  }).filter((w) => w.photos.length > 0);

  return Response.json({ weeks, hasOlder });
}
