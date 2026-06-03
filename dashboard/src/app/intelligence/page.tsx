import { redirect } from "next/navigation";

// The daily report now lives at `/` (the Reports tab). This route is kept only
// so existing Telegram broadcast + mini-app deep-links to `<DASHBOARD_URL>/intelligence`
// still land on the report.
export default function IntelligenceRedirect() {
  redirect("/");
}
