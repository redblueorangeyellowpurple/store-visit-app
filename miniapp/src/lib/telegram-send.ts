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

interface SendMessageOpts {
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled: boolean };
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
      console.error('[telegram-send] non-2xx:', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram-send] fetch failed:', err);
    return false;
  }
}
