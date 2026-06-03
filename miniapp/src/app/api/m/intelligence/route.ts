import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { supabase } from "@/lib/supabase";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Daily intelligence brief for the mini app. Leadership roles + explicit
// intelligence recipients only (mirrors the broadcast recipient logic).
export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  let allowed = cm.role !== "cm";
  if (!allowed) {
    const { data: flag } = await supabase
      .from("cms")
      .select("is_intelligence_recipient")
      .eq("telegram_id", cm.telegram_id)
      .single();
    allowed = !!flag?.is_intelligence_recipient;
  }
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { data: dates, error: dErr } = await supabase
    .from("v_intelligence_reports_current")
    .select("report_date, edited_by_human")
    .order("report_date", { ascending: false })
    .limit(30);
  if (dErr) return Response.json({ error: dErr.message }, { status: 500 });
  if (!dates || dates.length === 0) return Response.json({ report: null, dates: [] });

  const want = new URL(req.url).searchParams.get("date")?.trim();
  const target = want && ISO.test(want) ? want : dates[0].report_date;

  const { data: report, error: rErr } = await supabase
    .from("v_intelligence_reports_current")
    .select("report_date, version, edited_by_human, brief_markdown, created_at")
    .eq("report_date", target)
    .maybeSingle();
  if (rErr) return Response.json({ error: rErr.message }, { status: 500 });

  return Response.json({ report, dates });
}
