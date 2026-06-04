import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getActiveProducts } from "@/lib/queries";

// Managed product catalogue for the engagement editor's training picker.
// Any authenticated CM may read it — it's just the product master list.
export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const products = await getActiveProducts();
  return Response.json({ products });
}
