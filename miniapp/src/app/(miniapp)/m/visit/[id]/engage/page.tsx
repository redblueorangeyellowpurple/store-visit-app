"use client";

import { use, useEffect, useState } from "react";
import { initTelegram } from "../../../telegram-init";
import EngagementEditor, { type EngagedPersonRow } from "@/components/EngagementEditor";

// Hand-off entry point. The bot's visit-flow opens this via an inline web_app
// button at the people/engagements step. The editor mounts straight away in
// handoff mode; on Submit it saves via the API and closes the app. The bot stays
// parked at the People & Training prompt (it blocks there) — inline-launched apps
// can't sendData() anyway, so the CM taps Skip in chat to move on after logging.
// See visit-flow.ts.
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

  // Submit or cancel → close the app. The bot stays parked at the People &
  // Training prompt (its button is still there), so the CM can re-open to log
  // another person, or tap Skip/Back in chat. Nothing is sent, nothing stranded.
  const closeApp = () => window.Telegram?.WebApp?.close?.();

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
      onClose={closeApp}
      onSaved={() => {}}
      visitId={id}
      initData={initData}
      people={people}
      handoffMode
    />
  );
}
