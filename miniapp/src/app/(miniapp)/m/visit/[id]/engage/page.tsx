"use client";

import { use, useEffect, useState } from "react";
import { initTelegram } from "../../../telegram-init";
import EngagementEditor, { type EngagedPersonRow } from "@/components/EngagementEditor";

// Hand-off entry point. The bot's visit-flow opens this via a reply-keyboard
// web_app button at the people/engagements step. The editor mounts straight away
// in handoff mode; its Next/Skip call Telegram.WebApp.sendData(), which signals
// the bot to advance the visit flow and auto-closes the app. See visit-flow.ts.
export default function EngageHandoffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [initData, setInitData] = useState<string | null>(null);
  const [people, setPeople] = useState<EngagedPersonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await initTelegram();
        if (cancelled) return;
        if (!data) throw new Error("Open this from the bot to log engagements.");
        setInitData(data);
        const res = await fetch(`/api/m/visit/${id}`, {
          headers: { Authorization: `tma ${data}` },
        });
        if (!res.ok) throw new Error(`Couldn't load this visit (${res.status}).`);
        const json = await res.json();
        if (cancelled) return;
        setPeople(json.visit?.engaged_people ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Back/close without saving → skip the bot step rather than stranding it.
  const skip = () => window.Telegram?.WebApp?.sendData?.(JSON.stringify({ action: "skip" }));

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 text-center">
        <p className="text-[13px] text-ink-400">{error}</p>
      </div>
    );
  }

  if (!initData || people === null) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-[13px] text-ink-300">Loading…</p>
      </div>
    );
  }

  return (
    <EngagementEditor
      open
      onClose={skip}
      onSaved={() => {}}
      visitId={id}
      initData={initData}
      people={people}
      handoffMode
    />
  );
}
