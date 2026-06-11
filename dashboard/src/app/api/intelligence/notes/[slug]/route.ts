import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

interface Params { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { slug } = await params;

  const [{ data: note, error: nErr }, { data: history }, { data: edges }] = await Promise.all([
    supabase
      .from("v_memory_notes_current")
      .select("*")
      .eq("slug", slug)
      .maybeSingle(),
    supabase
      .from("memory_notes")
      .select("version, edited_by_human, last_touched_at, created_at")
      .eq("slug", slug)
      .order("version", { ascending: false })
      .limit(10),
    supabase
      .from("memory_edges")
      .select("from_slug, to_slug, edge_type")
      .or(`from_slug.eq.${slug},to_slug.eq.${slug}`),
  ]);

  if (nErr) {
    return Response.json({ error: nErr.message }, { status: 500 });
  }
  if (!note) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve related note titles for nicer display
  const relatedSlugs = note.related_slugs ?? [];
  let related: { slug: string; title: string; summary: string }[] = [];
  if (relatedSlugs.length > 0) {
    const { data: relData } = await supabase
      .from("v_memory_notes_current")
      .select("slug, title, summary")
      .in("slug", relatedSlugs);
    related = relData ?? [];
  }

  return Response.json({ note, history: history ?? [], edges: edges ?? [], related });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { slug } = await params;
  const body = await req.json().catch(() => ({})) as {
    summary?: string;
    body_markdown?: string;
    related_slugs?: string[];
  };

  // Get existing
  const { data: existing, error: exErr } = await supabase
    .from("memory_notes")
    .select("version, scope, scope_ref, title, summary, body_markdown, related_slugs, audience, status")
    .eq("slug", slug)
    .order("version", { ascending: false })
    .limit(1);

  if (exErr) {
    return Response.json({ error: exErr.message }, { status: 500 });
  }
  if (!existing || existing.length === 0) {
    return Response.json({ error: "Note not found" }, { status: 404 });
  }

  const prev = existing[0];
  const nextVersion = prev.version + 1;

  const { data: inserted, error } = await supabase
    .from("memory_notes")
    .insert({
      slug,
      scope: prev.scope,
      scope_ref: prev.scope_ref,
      title: prev.title,
      summary: body.summary ?? prev.summary,
      body_markdown: body.body_markdown ?? prev.body_markdown,
      related_slugs: body.related_slugs ?? prev.related_slugs,
      version: nextVersion,
      last_touched_at: new Date().toISOString(),
      edited_by_human: true,
      // audience/status are per-version — carry forward so a human edit
      // never resets a note to the 'cm' default or drops hypothesis status
      audience: prev.audience,
      status: prev.status,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ note: inserted });
}
