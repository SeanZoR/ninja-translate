import { config } from './config.js';

/**
 * Sends a one-line alert via Telegram if both ADMIN_TELEGRAM_CHAT_ID and
 * TELEGRAM_BOT_TOKEN are set. Failures are logged but never thrown - alerts
 * are best-effort, not critical path.
 */
export async function alert(message: string): Promise<void> {
  if (!config.telegramAlertChatId || !config.telegramBotToken) {
    console.log(`[alert] (telegram disabled) ${message}`);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramAlertChatId,
        text: `🥷 ninja-translate: ${message}`,
        disable_notification: false,
      }),
    });
    if (!res.ok) {
      console.error('[alert] telegram send failed', res.status, await res.text());
    }
  } catch (err) {
    console.error('[alert] telegram send error', err);
  }
}
