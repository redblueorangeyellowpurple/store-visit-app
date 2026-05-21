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
  // Pins each Telegram album (media_group_id) to whichever section was
  // active when its first photo arrived. Telegram only attaches the caption
  // to the first photo of an album; if that caption auto-advances the
  // conversation, trailing photos would otherwise inherit the next section.
  albumSections: Map<string, { section: SectionKey | null; ts: number }>;
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
    albumSections: new Map(),
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

export async function handleIncomingPhoto(
  telegramId: number,
  fileId: string,
  mediaGroupId?: string,
): Promise<void> {
  const c = collections.get(telegramId);
  if (!c) return;
  if (!botApi) {
    console.error('[photos] botApi not initialized — call initPhotoCollection(bot.api) at startup');
    return;
  }

  // Resolve the section before the network hops so trailing album photos
  // don't race against an in-flight section change.
  let section: SectionKey | null = c.currentSectionKey;
  if (mediaGroupId) {
    const pinned = c.albumSections.get(mediaGroupId);
    if (pinned) {
      section = pinned.section;
    } else {
      c.albumSections.set(mediaGroupId, { section, ts: Date.now() });
      // Drop stale entries (>30s old) so this map can't grow unbounded.
      const cutoff = Date.now() - 30_000;
      for (const [id, v] of c.albumSections) {
        if (v.ts < cutoff) c.albumSections.delete(id);
      }
    }
  }

  // Eager per-photo upload. No mid-flow ack — the final visit-done message
  // reports the total via awaitPhotoUpload(). Only count saves that actually
  // landed in the DB so the tally matches reality.
  try {
    const file = await botApi.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const saved = await uploadVisitPhoto(c.visitId, buffer, c.storeId, section);
    if (saved) c.savedCount++;
  } catch (err) {
    console.error('[photos] upload error:', err);
  }
}

// Called after back-nav wipes a section's photos in the DB. Keeps the running
// total accurate so the final "📸 N photos saved" tally matches reality.
// Saturating subtract — never goes below 0 even if state drifted.
export function adjustSavedCount(telegramId: number, delta: number): void {
  const c = collections.get(telegramId);
  if (c) c.savedCount = Math.max(0, c.savedCount + delta);
}

// Called on /cancel — DB rows + storage files are deleted elsewhere
// (deleteVisit cascades); this just clears the in-memory collection so the
// next /visit doesn't inherit stale state.
export function discardPhotoCollection(telegramId: number): void {
  collections.delete(telegramId);
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
