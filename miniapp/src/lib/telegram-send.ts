// Thin wrapper around Telegram's HTTP Bot API. The bot service uses grammY,
// but here in the miniapp we just call sendMessage directly — keeps this
// service free of a grammY dependency for one-off outbound messages.

interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

interface ReplyKeyboardMarkup {
  keyboard: { text: string }[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

interface SendMessageOpts {
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
  link_preview_options?: { is_disabled: boolean };
  message_thread_id?: number;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  opts: SendMessageOpts = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram-send] TELEGRAM_BOT_TOKEN missing');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...opts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // A stale/deleted topic returns 400 "message thread not found" — retry
      // into the group's General topic so the message isn't silently dropped.
      if (opts.message_thread_id != null && /thread not found/i.test(body)) {
        console.warn(`[telegram-send] thread ${opts.message_thread_id} not found for chat ${chatId} — falling back to General`);
        const { message_thread_id: _drop, ...rest } = opts;
        return sendTelegramMessage(chatId, text, rest);
      }
      console.error('[telegram-send] non-2xx:', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram-send] fetch failed:', err);
    return false;
  }
}
