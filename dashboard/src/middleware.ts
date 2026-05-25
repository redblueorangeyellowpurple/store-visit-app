import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/auth/", "/api/health"];
const ALLOWED_ROLES = new Set(["am", "cmic", "admin"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = req.cookies.get("sva-dash-session")?.value;
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  try {
    const dot = session.lastIndexOf(".");
    if (dot === -1) throw new Error();
    // atob is available in Edge runtime
    const data = JSON.parse(atob(session.slice(0, dot)));
    if (typeof data.exp !== "number" || data.exp < Date.now()) throw new Error();
    if (!data.role || !ALLOWED_ROLES.has(data.role)) {
      const url = new URL("/login", req.url);
      url.searchParams.set("error", "cm_only");
      const res = NextResponse.redirect(url);
      res.cookies.delete("sva-dash-session");
      return res;
    }
    if (pathname.startsWith("/admin") && data.role !== "admin") {
      const url = new URL("/", req.url);
      url.searchParams.set("error", "admin_only");
      return NextResponse.redirect(url);
    }
  } catch {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete("sva-dash-session");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
