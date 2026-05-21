import { Api } from 'grammy';
import { uploadVisitPhoto, type SectionKey } from '../db/queries/photos.js';
import { config } from '../config.js';

interface PhotoCollection {
  visitId: string;
  storeId: string;
  storeName: string;
  chatId: number;
  sections: number;
  currentSectionKey: SectionKey | null;
  savedCount: number;
  // Photos arrive one-by-one even when sent as an album. Batch the "📸 saved"
  // acknowledgment so albums produce one reply, not N.
  ackTimer: NodeJS.Timeout | null;
  ackPending: number;
}

// Process-level state — persists within Railway's single-process lifetime.
const collections = new Map<number, PhotoCollection>();

// Set once at startup via initPhotoCollection(bot.api).
// Using bot.api directly avoids the grammY conversation replay wrapper,
// which throws if you call ctx.api after a conversation has exited.
let botApi: Api | undefined;

export function initPhotoCollection(api: Api): void {
  botApi = api;
}

export function startPhotoCollection(
  telegramId: number,
  visitId: string,
  storeId: string,
  storeName: string,
  chatId: number,
  sections: number,
): void {
  collections.set(telegramId, {
    visitId,
    storeId,
    storeName,
    chatId,
    sections,
    currentSectionKey: null,
    savedCount: 0,
    ackTimer: null,
    ackPending: 0,
  });
}

export function isCollecting(telegramId: number): boolean {
  return collections.has(telegramId);
}

// Called by the visit conversation as each prompt becomes active. Photos
// arriving while a section is active inherit that section_key on insert.
export function setActiveSection(telegramId: number, sectionKey: SectionKey | null): void {
  const c = collections.get(telegramId);
  if (c) c.currentSectionKey = sectionKey;
}

export async function handleIncomingPhoto(telegramId: number, fileId: string): Promise<void> {
  const c = collections.get(telegramId);
  if (!c) return;
  if (!botApi) {
    console.error('[photos] botApi not initialized — call initPhotoCollection(bot.api) at startup');
    return;
  }

  // Eager per-photo upload. We do not debounce: the previous batching design
  // tore down the collection 2s after creation, silently dropping every photo
  // sent after the user read the prompt.
  try {
    const file = await botApi.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    await uploadVisitPhoto(c.visitId, buffer, c.storeId, c.currentSectionKey);
    c.savedCount++;
    c.ackPending++;
  } catch (err) {
    console.error('[photos] upload error:', err);
    return;
  }

  // Batch the acknowledgment: schedule (or reset) a 900ms timer that sends
  // "📸 N saved" once the album finishes arriving.
  if (c.ackTimer) clearTimeout(c.ackTimer);
  c.ackTimer = setTimeout(() => {
    const pending = c.ackPending;
    c.ackPending = 0;
    c.ackTimer = null;
    if (botApi && pending > 0) {
      botApi
        .sendMessage(c.chatId, `📸 ${pending} ${pending === 1 ? 'photo' : 'photos'} saved`)
        .catch((err) => console.error('[photos] ack send error:', err));
    }
  }, 900);
}

// Called at the end of the visit flow. Returns total photos saved for this
// visit, then tears down the collection.
export async function awaitPhotoUpload(visitId: string): Promise<number> {
  for (const [telegramId, c] of collections) {
    if (c.visitId === visitId) {
      // Flush any in-flight ack so the count message lands before the Done
      // banner.
      if (c.ackTimer) {
        clearTimeout(c.ackTimer);
        c.ackTimer = null;
      }
      const saved = c.savedCount;
      collections.delete(telegramId);
      return saved;
    }
  }
  return 0;
}
