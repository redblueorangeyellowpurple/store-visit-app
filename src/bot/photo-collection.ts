import { Api } from 'grammy';
import { uploadVisitPhoto, type SectionKey } from '../db/queries/photos.js';
import { config } from '../config.js';

// A run of photos the CM sent close together (a Telegram album, or a quick
// one-at-a-time dribble). Each batch gets ONE chat message that starts as
// "📸 Saving N photos…" and edits to "✓ N photos saved" once its uploads
// settle — counting actual successes, not just settled promises.
interface PhotoBatch {
  count: number;
  success: number;
  promises: Promise<void>[];
  timer: ReturnType<typeof setTimeout> | null;
}

interface PhotoCollection {
  visitId: string;
  storeId: string;
  storeName: string;
  chatId: number;
  sections: number;
  currentSectionKey: SectionKey | null;
  savedCount: number;
  // In-flight upload promises. awaitPhotoUpload drains these before returning
  // the final count so fire-and-forget uploads from the visit flow don't race
  // against the lock step.
  pendingUploads: Set<Promise<void>>;
  // Pins each Telegram album (media_group_id) to whichever section was
  // active when its first photo arrived. Telegram only attaches the caption
  // to the first photo of an album; if that caption auto-advances the
  // conversation, trailing photos would otherwise inherit the next section.
  albumSections: Map<string, { section: SectionKey | null; ts: number }>;
  // The open status batch, if any. Folds photos arriving within
  // BATCH_WINDOW_MS into a single saving→saved message. Lives here (not in the
  // conversation) so it posts via the bot.api singleton, immune to grammY
  // conversation replay.
  currentBatch: PhotoBatch | null;
}

// How long to wait after the last photo before posting a batch's "saving"
// message. Long enough to fold an album (its N updates arrive near-instantly)
// or a rapid one-at-a-time dribble into one message; short enough to feel live.
const BATCH_WINDOW_MS = 900;

// Process-level state — persists within Railway's single-process lifetime.
const collections = new Map<number, PhotoCollection>();

// Set once at startup via initPhotoCollection(bot.api).
// Using bot.api directly avoids the grammY conversation replay wrapper,
// which throws if you call ctx.api after a conversation has exited.
let botApi: Api | undefined;

export function initPhotoCollection(api: Api): void {
  botApi = api;
}

// The bot.api singleton, for side-effects that must outlive the conversation
// (e.g. the team broadcast fired after a visit is logged). ctx.api throws once
// a conversation has exited; this doesn't. Undefined only if startup skipped
// initPhotoCollection.
export function getBotApi(): Api | undefined {
  return botApi;
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
    pendingUploads: new Set(),
    albumSections: new Map(),
    currentBatch: null,
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

  // Open or extend the current status batch (folds an album + rapid singles
  // into one saving→saved message).
  if (!c.currentBatch) c.currentBatch = { count: 0, success: 0, promises: [], timer: null };
  const batch = c.currentBatch;
  batch.count++;

  // Fire-and-forget upload — the conversation flow does NOT await this.
  // awaitPhotoUpload() drains pendingUploads before locking the visit.
  // 30s AbortSignal guards against indefinite network hangs (no built-in
  // timeout on fetch or Supabase storage calls).
  const p = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const file = await botApi.getFile(fileId);
      // Reject oversized files before downloading into memory — Railway's
      // instance heap is small and a 15MB+ photo (or several at once) can
      // spike RAM. Telegram caps photos at ~10MB but lets through larger
      // documents-as-photos.
      if (file.file_size && file.file_size > 15_000_000) {
        console.warn(`[photos] skipping oversized file (${file.file_size} bytes) for visit ${c.visitId}`);
        return;
      }
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      const resp = await fetch(url, { signal: controller.signal });
      const buffer = Buffer.from(await resp.arrayBuffer());
      const saved = await uploadVisitPhoto(c.visitId, buffer, c.storeId, section);
      if (saved) { c.savedCount++; batch.success++; }
    } catch (err) {
      console.error('[photos] upload error:', err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timer);
    }
  })();
  batch.promises.push(p);
  c.pendingUploads.add(p);
  void p.finally(() => c.pendingUploads.delete(p));

  // Trailing debounce: each new photo pushes the flush back, so a whole album
  // posts a single "Saving N…" message rather than one per photo.
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => { void flushBatchStatus(c, batch); }, BATCH_WINDOW_MS);
}

const photoNoun = (n: number): string => `${n} ${n === 1 ? 'photo' : 'photos'}`;

// Posts one "📸 Saving N photos…" message for a settled batch, then edits it to
// the truthful outcome once the uploads finish. Best-effort: any failure here
// is logged but never propagates into the upload path. Outside the conversation
// → uses the bot.api singleton, no replay concerns.
async function flushBatchStatus(c: PhotoCollection, batch: PhotoBatch): Promise<void> {
  if (c.currentBatch === batch) c.currentBatch = null; // close it; next photo opens a fresh batch
  if (!botApi || batch.count === 0) return;
  try {
    const sent = await botApi.sendMessage(c.chatId, `📸 Saving ${photoNoun(batch.count)}…`);
    await Promise.allSettled(batch.promises);
    const ok = batch.success;
    const total = batch.count;
    const text =
      ok === total ? `✓ ${photoNoun(total)} saved`
      : ok === 0 ? `⚠️ Couldn't save ${photoNoun(total)} — please resend`
      : `✓ ${ok} of ${total} saved — ${total - ok} failed, resend the rest?`;
    await botApi.editMessageText(c.chatId, sent.message_id, text).catch(() => {});
  } catch (err) {
    console.error('[photos] batch status error:', err instanceof Error ? err.message : err);
  }
}

// Cancels a pending batch flush so no stray "saving…" message fires after the
// collection is torn down (finalize) or discarded (/cancel).
function clearBatchTimer(c: PhotoCollection): void {
  if (c.currentBatch?.timer) {
    clearTimeout(c.currentBatch.timer);
    c.currentBatch.timer = null;
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
  const c = collections.get(telegramId);
  if (c) clearBatchTimer(c);
  collections.delete(telegramId);
}

export function hasPendingUploads(visitId: string): boolean {
  for (const c of collections.values()) {
    if (c.visitId === visitId) return c.pendingUploads.size > 0;
  }
  return false;
}

// Called at the end of the visit flow. Drains all in-flight uploads (up to
// 10s) then returns the final count and tears down the collection.
export async function awaitPhotoUpload(visitId: string): Promise<number> {
  for (const [telegramId, c] of collections) {
    if (c.visitId === visitId) {
      clearBatchTimer(c); // the finalize message reports the final tally; no late per-batch ping
      if (c.pendingUploads.size > 0) {
        await Promise.race([
          Promise.allSettled([...c.pendingUploads]),
          new Promise<void>(resolve => setTimeout(resolve, 10_000)),
        ]);
      }
      const saved = c.savedCount;
      collections.delete(telegramId);
      return saved;
    }
  }
  return 0;
}
