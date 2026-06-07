import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getStaffDetailForCM, updateStaffProfile } from "@/lib/queries";

// Per-staff detail + lifetime engagement rollup for the m/staff/[id] screen.
// Any authed CM may view (staff belong to stores in the shared portfolio).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const staff = await getStaffDetailForCM(id);
  if (!staff) return Response.json({ error: "Staff not found" }, { status: 404 });
  return Response.json({ staff });
}

// Edit a staff member's profile (age + bio). age/bio columns from mig 026.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const fields: { age?: number | null; bio?: string | null } = {};

  if ("age" in body) {
    if (body.age === null || body.age === "") {
      fields.age = null;
    } else {
      const n = Number(body.age);
      if (!Number.isInteger(n) || n < 14 || n > 100) {
        return Response.json({ error: "Age must be a whole number between 14 and 100" }, { status: 400 });
      }
      fields.age = n;
    }
  }

  if ("bio" in body) {
    if (body.bio === null || typeof body.bio === "string") {
      const trimmed = typeof body.bio === "string" ? body.bio.trim() : null;
      fields.bio = trimmed ? trimmed : null;
    }
  }

  if (Object.keys(fields).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  const ok = await updateStaffProfile(id, fields);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });

  const staff = await getStaffDetailForCM(id);
  return Response.json({ staff });
}
