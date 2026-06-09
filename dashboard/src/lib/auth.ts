import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const COOKIE_NAME = "sva-dash-session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DashboardRole = "am" | "cmic" | "admin";
export const DASHBOARD_ROLES: DashboardRole[] = ["am", "cmic", "admin"];

export interface SessionUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  role: DashboardRole;
  exp: number;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing SESSION_SECRET");
  return s;
}

export function verifyTelegramHash(params: Record<string, string>): boolean {
  const { hash, ...rest } = params;
  if (!hash) return false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;
  const secretKey = createHash("sha256").update(botToken).digest();
  const dataStr = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const expectedHex = createHmac("sha256", secretKey).update(dataStr).digest("hex");
  if (expectedHex.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(hash, "hex"));
}

export function createSessionCookie(user: Omit<SessionUser, "exp">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64");
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionCookie(cookie: string): SessionUser | null {
  const dot = cookie.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  if (expected !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64").toString()) as SessionUser;
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): SessionUser | null {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifySessionCookie(cookie);
}

export function requireDashboardRole(req: NextRequest): SessionUser | null {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  if (!DASHBOARD_ROLES.includes(session.role)) return null;
  return session;
}

export function requireAdmin(req: NextRequest): SessionUser | null {
  const session = requireDashboardRole(req);
  if (!session) return null;
  if (session.role !== "admin") return null;
  return session;
}

export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
  secure: process.env.NODE_ENV === "production",
};
