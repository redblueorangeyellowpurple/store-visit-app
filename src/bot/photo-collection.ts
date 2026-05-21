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

  // Eager per-photo upload. No mid-flow ack — the final visit-done message
  // reports the total via awaitPhotoUpload().
  try {
    const file = await botApi.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    await uploadVisitPhoto(c.visitId, buffer, c.storeId, c.currentSectionKey);
    c.savedCount++;
  } catch (err) {
    console.error('[photos] upload error:', err);
  }
}

// Called at the end of the visit flow. Returns total photos saved for this
// visit, then tears down the collection.
export async function awaitPhotoUpload(visitId: string): Promise<number> {
  for (const [telegramId, c] of collections) {
    if (c.visitId === visitId) {
      const saved = c.savedCount;
      collections.delete(telegramId);
      return saved;
    }
  }
  return 0;
}
