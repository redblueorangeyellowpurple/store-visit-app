import { Context, InputMediaBuilder } from 'grammy';
import { getFullVisit } from '../db/queries/visits.js';
import { getPhotosForVisit, signPhotoUrls } from '../db/queries/photos.js';
import { listFollowUpsForVisit, type VisitFollowUp } from '../db/queries/visit-follow-ups.js';
import { getVisitEngagements, type VisitEngagedPersonItem } from '../db/queries/staff.js';

// V2 order: 4 prompts. Legacy buzz_plan kept at the end so old visits still
// render anything they had there. follow_up freetext rendered only when no
// structured visit_follow_ups rows exist (the structured list supersedes it).
const SECTION_DEFS: Array<{
  key: 'good_news' | 'people_training' | 'competitors' | 'display_stock' | 'buzz_plan';
  label: string;
  emoji: string;
}> = [
  { key: 'good_news',       label: 'Good News',           emoji: '🎉' },
  { key: 'people_training', label: 'People & Training',   emoji: '👥' },
  { key: 'competitors',     label: 'Competitor Insights', emoji: '🔍' },
  { key: 'display_stock',   label: 'Display & Stock',     emoji: '📦' },
  { key: 'buzz_plan',       label: 'Buzz Plan',           emoji: '⚡' },
];

const TG_CAPTION_LIMIT = 1000; // Telegram caps at 1024; leave headroom for markdown overhead

// Shared text-only body for a visit (date + filled sections + people/training +
// follow-ups). No store-name line — callers prepend their own title. Used by the
// DM details view and the group broadcast so they stay in sync.
interface VisitSummaryFields {
  visit_date: string;
  good_news: string | null;
  people_training: string | null;
  competitors: string | null;
  display_stock: string | null;
  buzz_plan: string | null;
  follow_up: string | null;
}

// Escape legacy-Markdown control chars in user-supplied text so a stray `_`/`*`
// in a note can't 400 the send (critical for the group broadcast). Structural
// `*bold*` markers are added by us and stay unescaped.
export function escapeMd(s: string): string {
  return s.replace(/([_*`[\]])/g, '\\$1');
}

export function formatVisitSummaryBody(
  visit: VisitSummaryFields,
  followUps: VisitFollowUp[],
  engagedPeople: VisitEngagedPersonItem[],
): string {
  const date = new Date(visit.visit_date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const lines: string[] = [`📅 ${date}`, ''];
  let anyFilled = false;

  for (const { key, label, emoji } of SECTION_DEFS) {
    if (key === 'people_training') {
      // New model: render the engaged people; fall back to the legacy text.
      if (engagedPeople.length > 0) {
        anyFilled = true;
        lines.push(`${emoji} *${label}*`);
        for (const person of engagedPeople) {
          lines.push(`• *${escapeMd(person.name)}*`);
          if (person.update_text) lines.push(`  ${escapeMd(person.update_text)}`);
          for (const t of person.trainings) {
            const resp = t.response ? ` — ${escapeMd(t.response)}` : '';
            lines.push(`  🎓 ${escapeMd(t.product_name)}${resp}`);
          }
        }
        lines.push('');
        continue;
      }
    }
    const val = visit[key];
    if (val) {
      anyFilled = true;
      lines.push(`${emoji} *${label}*`, escapeMd(val), '');
    }
  }

  if (followUps.length > 0) {
    anyFilled = true;
    const openCount = followUps.filter((f) => f.status === 'open').length;
    lines.push(`✅ *Follow-ups (${openCount} open)*`);
    for (const f of followUps) {
      const box = f.status === 'done' ? '☑' : '☐';
      const due = f.due_date ? ` · ${f.due_date}` : '';
      lines.push(`${box} ${escapeMd(f.title)}${due}`);
    }
    lines.push('');
  } else if (visit.follow_up) {
    anyFilled = true;
    lines.push('✅ *Follow-up*', escapeMd(visit.follow_up), '');
  }

  if (!anyFilled) lines.push('_No notes were added for this visit._');
  return lines.join('\n').trimEnd();
}

export async function sendVisitDetails(ctx: Context, visitId: string): Promise<void> {
  const visit = await getFullVisit(visitId);
  if (!visit) {
    await ctx.reply("Couldn't find that visit.");
    return;
  }
  if (visit.cm_telegram_id !== ctx.from?.id) {
    await ctx.reply("You don't have access to that visit.");
    return;
  }

  const [photos, followUps, engagedPeople] = await Promise.all([
    getPhotosForVisit(visitId),
    listFollowUpsForVisit(visitId),
    getVisitEngagements(visitId),
  ]);
  const photoUrls =
    photos.length > 0
      ? await signPhotoUrls(photos.map((p) => p.storage_path))
      : [];

  let text = `🏪 *${escapeMd(visit.store_name)}*\n${formatVisitSummaryBody(visit, followUps, engagedPeople)}`;

  // If photos exist but signing failed, show count so user knows they're there
  if (photos.length > 0 && photoUrls.length === 0) {
    text += `\n\n📸 ${photos.length} photo(s) (preview unavailable)`;
  }

  // No photos to send → text only
  if (photoUrls.length === 0) {
    await ctx.reply(text, { parse_mode: 'Markdown' });
    return;
  }

  const captionFits = text.length <= TG_CAPTION_LIMIT;

  // Caption too long → text separately, photos with no caption
  if (!captionFits) {
    await ctx.reply(text, { parse_mode: 'Markdown' });
    if (photoUrls.length === 1) {
      await ctx.replyWithPhoto(photoUrls[0]);
    } else {
      await ctx.replyWithMediaGroup(
        photoUrls.map((url) => InputMediaBuilder.photo(url)),
      );
    }
    return;
  }

  // Caption fits → attach to photo(s), same shape as original submission
  if (photoUrls.length === 1) {
    await ctx.replyWithPhoto(photoUrls[0], {
      caption: text,
      parse_mode: 'Markdown',
    });
  } else {
    await ctx.replyWithMediaGroup(
      photoUrls.map((url, i) =>
        i === 0
          ? InputMediaBuilder.photo(url, { caption: text, parse_mode: 'Markdown' })
          : InputMediaBuilder.photo(url),
      ),
    );
  }
}
