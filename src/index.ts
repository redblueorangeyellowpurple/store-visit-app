import express from 'express';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { createBot } from './bot/bot.js';
import { getJoinRequestAdmins, listAlertGroups } from './db/queries/alert-groups.js';
import { registerMorningCrons } from './cron/morning-cron.js';

const bot = createBot();
// Morning pipeline scheduler: 08:00 SGT preview to Wilson, 09:00 SGT team send
// (intelligence broadcast + per-CM recaps). No-op unless MORNING_CRON_ENABLED=true;
// the 9am recaps still honour the daily_recaps_enabled master switch. createBot()
// has already run initPhotoCollection(bot.api), so the bot.api singleton the cron
// sends through is ready. Replaces the former standalone recap cron — the 9am
// send now handles the recaps.
registerMorningCrons();
const app = express();

async function startupHealthCheck(): Promise<void> {
  try {
    const [admins, groups] = await Promise.all([getJoinRequestAdmins(), listAlertGroups()]);
    if (admins.length === 0) {
      console.warn(
        '[startup] ⚠ No CMs flagged is_join_request_admin — join requests will fall back to JOIN_REQUEST_CHAT_ID env. Flag at least one admin in the dashboard People tab.',
      );
    } else {
      console.log(`[startup] join-request DM recipients: ${admins.map((a) => a.full_name).join(', ')}`);
    }
    const unset = groups.filter((g) => !g.chat_id).map((g) => g.market);
    if (unset.length > 0) {
      console.warn(
        `[startup] ⚠ Markets with no alert chat_id: ${unset.join(', ')} — visit-lock broadcasts there will DM admins instead. Configure in the dashboard Admin tab.`,
      );
    }
  } catch (err) {
    console.error('[startup] healthCheck failed:', err);
  }
}

// Health check for Railway
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Telegram webhook — secret_token header gives defense-in-depth on top of
// the URL-path secret: even if the URL leaks (logs, env dumps), the header
// check still rejects forged updates.
app.use(
  `/webhook/${config.telegram.webhookSecret}`,
  express.json(),
  // grammY's default webhook timeout is 10s and THROWS on expiry, which makes
  // Telegram retry the same update. A slow photo upload on a poor connection
  // (e.g. an overseas CM) keeps the in-flow 10s awaitPhotoUpload wait busy right
  // as that 10s webhook timeout fires — the update never gets a 200, Telegram
  // retries, the conversation replays into the same wait, and that one CM is
  // frozen until redeploy. 'return' sends a 200 instead of throwing (no retry
  // storm), and 60s gives slow handlers room to finish inside the window.
  webhookCallback(bot, 'express', {
    secretToken: config.telegram.webhookSecret,
    onTimeout: 'return',
    timeoutMilliseconds: 60_000,
  }),
);

// Start server and set webhook
app.listen(config.webhook.port, async () => {
  const webhookUrl = `${config.webhook.domain}/webhook/${config.telegram.webhookSecret}`;
  await bot.api.setWebhook(webhookUrl, { secret_token: config.telegram.webhookSecret });
  console.log(`Bot server running on port ${config.webhook.port}`);
  console.log(`Webhook set to ${webhookUrl}`);
  await startupHealthCheck();
});
