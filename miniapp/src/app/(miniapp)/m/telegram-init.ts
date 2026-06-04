"use client";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { start_param?: string };
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
        // Stops the swipe-down gesture from closing the app, so the page can
        // scroll its own content instead (Bot API 7.7+).
        disableVerticalSwipes?: () => void;
        // Only fires when the app was opened from a reply-keyboard web_app
        // button; sends a web_app_data message to the bot and closes the app.
        sendData?: (data: string) => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
      };
    };
  }
}

export function getStartParam(): string | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? null;
}

let scriptPromise: Promise<void> | null = null;

export function loadTelegramScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.Telegram?.WebApp) return resolve();
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Telegram script failed"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function initTelegram(): Promise<string | null> {
  await loadTelegramScript();
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) return null;
  tg.ready?.();
  tg.expand?.();
  tg.disableVerticalSwipes?.(); // let pages scroll instead of swipe-closing
  return tg.initData;
}
