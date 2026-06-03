"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { initTelegram, getStartParam } from "./telegram-init";

// Bot builds startapp params like:
//   visit_<uuid>                → /m/visit/<uuid>
//   visit_<uuid>_training       → /m/visit/<uuid>#training  (auto-opens training editor)
//   visit_<uuid>_followup       → /m/visit/<uuid>/followup
// Anything else falls through to the default /m/visits tab.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VISIT_TRAINING = new RegExp(`^visit_(${UUID})_training$`, "i");
const VISIT_FOLLOWUP = new RegExp(`^visit_(${UUID})_followup$`, "i");
const VISIT_EDIT = new RegExp(`^visit_(${UUID})_edit$`, "i");
const VISIT_BARE = new RegExp(`^visit_(${UUID})$`, "i");

export default function MiniappRoot() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await initTelegram().catch(() => null);
      const param = getStartParam();

      if (param) {
        let m: RegExpExecArray | null;
        if (/^intel$/i.test(param)) {
          router.replace("/m/intel");
          return;
        }
        if ((m = VISIT_TRAINING.exec(param))) {
          router.replace(`/m/visit/${m[1]}#training`);
          return;
        }
        if ((m = VISIT_FOLLOWUP.exec(param))) {
          router.replace(`/m/visit/${m[1]}/followup`);
          return;
        }
        if ((m = VISIT_EDIT.exec(param))) {
          router.replace(`/m/visit/${m[1]}/edit`);
          return;
        }
        if ((m = VISIT_BARE.exec(param))) {
          router.replace(`/m/visit/${m[1]}`);
          return;
        }
      }
      router.replace("/m/visits");
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-center text-sm text-ink-300">Loading…</p>
    </main>
  );
}
