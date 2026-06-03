import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  createProduct,
  getAllProducts,
  updateProduct,
} from "@/lib/queries";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const products = await getAllProducts();
  return Response.json({ products });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const brand = typeof body.brand === "string" ? body.brand.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!brand) return Response.json({ error: "brand required" }, { status: 400 });
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const row = await createProduct({ brand, name });
  if (!row) return Response.json({ error: "create failed (duplicate brand+name?)" }, { status: 500 });
  return Response.json({ product: row });
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.brand !== undefined) patch.brand = String(body.brand).trim();
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const ok = await updateProduct(body.id, patch);
  if (!ok) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}
