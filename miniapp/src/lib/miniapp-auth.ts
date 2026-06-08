import crypto from "crypto";

// Telegram Mini App initData verification.
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//   secret_key  = HMAC_SHA256(key="WebAppData", message=bot_token)
//   data_check  = sorted "key=value" lines (all fields except `hash`), joined by \n
//   expected    = HMAC_SHA256(key=secret_key, message=data_check)
//   valid iff   expected === initData.hash

const MAX_AGE_SECONDS = 24 * 60 * 60;

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Missing TELEGRAM_BOT_TOKEN env var");
  return t;
}

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedInitData {
  user: InitDataUser;
  authDate: number;
}

export function verifyInitData(initData: string): VerifiedInitData | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheck = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken()).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheck).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (expectedBuf.length !== hashBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, hashBuf)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > MAX_AGE_SECONDS) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  let user: InitDataUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return null;
  }

  return { user, authDate };
}

export function readInitDataHeader(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("tma ")) return null;
  return auth.slice(4);
}

export interface AuthedCM {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: "cm" | "cmic" | "am" | "admin";
  market: "SG" | "TH" | "MY" | "HK";
  // Set only when a real admin is viewing the app "as" another CM (view-as
  // mode). Downstream routes transparently see the *target* identity; these
  // fields carry the truth about who is really behind the session.
  impersonating?: boolean;
  real_telegram_id?: number;
  real_name?: string;
}

// Header carrying the view-as target's telegram id. The mini app's root-layout
// fetch shim adds it to every /api/m/* request when an admin has picked someone
// to view as (the choice lives in sessionStorage → it naturally resets when the
// app is reopened). It rides the same requests as the Authorization header, so
// there's no separate persistence to fail. Only honoured when the verified
// caller is a real admin — a forged header therefore grants nothing.
export const VIEW_AS_HEADER = "x-view-as";

function readViewAsHeader(req: Request): number | null {
  const raw = req.headers.get(VIEW_AS_HEADER);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function fetchActiveCM(telegramId: number): Promise<AuthedCM | null> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase
    .from("cms")
    .select("telegram_id, full_name, nickname, role, market")
    .eq("telegram_id", telegramId)
    .eq("is_active", true)
    .single();
  if (error || !data) return null;
  return data as AuthedCM;
}

// The *real* signed-in CM, derived purely from cryptographically-verified
// Telegram initData — never swapped for a view-as target. The view-as routes
// themselves use this so an admin in view-as mode can still manage (and exit)
// their own session.
export async function realCMFromRequest(req: Request): Promise<AuthedCM | null> {
  const initData = readInitDataHeader(req);
  if (!initData) return null;
  const verified = verifyInitData(initData);
  if (!verified) return null;
  return fetchActiveCM(verified.user.id);
}

export async function authedCMFromRequest(
  req: Request,
): Promise<AuthedCM | null> {
  const real = await realCMFromRequest(req);
  if (!real) return null;

  // View-as: only a real admin may borrow another active CM's identity.
  if (real.role === "admin") {
    const targetId = readViewAsHeader(req);
    if (targetId && targetId !== real.telegram_id) {
      const target = await fetchActiveCM(targetId);
      if (target) {
        return {
          ...target,
          impersonating: true,
          real_telegram_id: real.telegram_id,
          real_name: real.nickname ?? real.full_name,
        };
      }
      // target gone/inactive → fall through to the admin's own identity
    }
  }
  return real;
}

// Standard 403 for mutation routes when the caller is in view-as (read-only)
// mode. Keeps the message identical across every write route.
export function viewAsReadOnly(): Response {
  return Response.json(
    { error: "View-as is read-only — exit view-as to make changes." },
    { status: 403 },
  );
}
