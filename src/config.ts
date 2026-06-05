import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string): string | undefined {
  return process.env[key] || undefined;
}

export const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    webhookSecret: required('TELEGRAM_WEBHOOK_SECRET'),
  },
  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  webhook: {
    domain: required('WEBHOOK_DOMAIN'),
    port: parseInt(process.env.PORT || '3000', 10),
  },
  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY'),
  },
  resend: {
    apiKey: optional('RESEND_API_KEY'),
  },
  dashboard: {
    url: optional('DASHBOARD_URL'),
  },
  miniapp: {
    url: optional('MINIAPP_URL'),
    shortName: process.env.TELEGRAM_MINIAPP_SHORT_NAME || 'miniapp',
  },
  broadcast: {
    chatId: optional('BROADCAST_CHAT_ID'),
    botUsername: optional('TELEGRAM_BOT_USERNAME'),
  },
  joinRequests: {
    // Falls back to BROADCAST_CHAT_ID if not set.
    chatId: optional('JOIN_REQUEST_CHAT_ID') || optional('BROADCAST_CHAT_ID'),
  },
  admin: {
    // Telegram chat that receives the 08:00 morning preview + 09:00 send summary
    // (Wilson, 806982232). If unset, those admin DMs are skipped.
    chatId: optional('ADMIN_TELEGRAM_ID'),
  },
} as const;
