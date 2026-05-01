import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const root = process.env.NINJA_HOME ?? path.join(home, '.ninja-translate');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  root,
  dbPath: optional('DB_PATH', path.join(root, 'data.db')),
  audioDir: optional('AUDIO_DIR', path.join(root, 'audio')),
  sessionDir: optional('SESSION_DIR', path.join(root, 'wa-session')),

  geminiApiKey: () => required('GEMINI_API_KEY'),
  geminiModel: optional('GEMINI_MODEL', 'gemini-2.5-flash'),

  botJid: process.env.BOT_JID ?? null,

  adminHost: optional('ADMIN_HOST', '127.0.0.1'),
  adminPort: Number(optional('ADMIN_PORT', '7878')),

  // CF Access JWT verification (production only).
  // CF_ACCESS_TEAM_DOMAIN is e.g. "your-team.cloudflareaccess.com"
  // CF_ACCESS_AUD is the AUD tag from the CF Access app for the API origin.
  cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN ?? null,
  cfAccessAud: process.env.CF_ACCESS_AUD ?? null,
  // Comma-separated list of origins allowed to call the API (CF Pages domain).
  apiAllowedOrigins: optional('API_ALLOWED_ORIGINS', 'https://translate.your-domain.com').split(',').map(s => s.trim()),

  // Public, *un*-gated base URL for the per-user settings page (e.g. `https://u.translate.your-domain.com`).
  // The bot embeds magic-link URLs like `<base>/u/<token>` into DM auto-replies.
  // When unset, DM replies fall back to `http://<adminHost>:<adminPort>` (local-dev path).
  publicUserBaseUrl: process.env.PUBLIC_USER_BASE_URL ?? null,

  telegramAlertChatId: process.env.ADMIN_TELEGRAM_CHAT_ID ?? null,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? null,

  fallbackEnabled: optional('TRANSLATOR_FALLBACK', 'false') === 'true',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
};

export type Config = typeof config;
