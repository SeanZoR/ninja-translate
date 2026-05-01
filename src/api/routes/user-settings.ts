import { Hono } from 'hono';
import { z } from 'zod';
import { repo } from '../../db/index.js';

// Closed list of language codes the rest of the system understands. Keep in
// sync with src/translator/gemini.ts LANGUAGE_NAMES + web/app.js AVAILABLE_LANGUAGES.
const LANG_CODES = ['en', 'th', 'he', 'my', 'ms', 'tl', 'id', 'es', 'ru', 'zh', 'fr', 'de'] as const;

const overridesSchema = z.object({
  polishLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]).optional(),
  tone: z.union([z.literal('formal'), z.literal('neutral'), z.literal('casual'), z.null()]).optional(),
  sourceLanguageHint: z.union([z.enum(LANG_CODES), z.null()]).optional(),
  voiceTranslate: z.union([z.boolean(), z.null()]).optional(),
  showSourceLabel: z.union([z.boolean(), z.null()]).optional(),
  showProcessingReaction: z.union([z.boolean(), z.null()]).optional(),
});

export function userSettingsRoutes() {
  const r = new Hono();

  r.get('/:token/me', (c) => {
    const token = c.req.param('token');
    const userJid = repo.userJidForToken(token);
    if (!userJid) return c.json({ error: 'invalid or expired token' }, 404);

    const user = repo.getUser(userJid);
    return c.json({
      overrides: {
        polishLevel: user?.polishLevel ?? null,
        tone: user?.tone ?? null,
        sourceLanguageHint: user?.sourceLanguageHint ?? null,
        voiceTranslate: user?.voiceTranslate ?? null,
        showSourceLabel: user?.showSourceLabel ?? null,
        showProcessingReaction: user?.showProcessingReaction ?? null,
      },
      // Bot-level defaults shown as inheritance hints when a user clears an
      // override. Real per-group resolution is non-trivial (a user is in
      // many groups) so the UI just shows a generic "group default" label.
      defaults: {
        polishLevel: 2,
        tone: 'neutral',
        sourceLanguageHint: null,
        voiceTranslate: true,
        showSourceLabel: true,
        showProcessingReaction: false,
      },
    });
  });

  r.patch('/:token/me', async (c) => {
    const token = c.req.param('token');
    const userJid = repo.userJidForToken(token);
    if (!userJid) return c.json({ error: 'invalid or expired token' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = overridesSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'validation failed', detail: parsed.error.flatten() }, 400);

    // Read existing first so a PATCH only touches the keys present in the
    // request — missing keys preserve their current value, explicit nulls
    // clear the override back to "inherit from group".
    const existing = repo.getUser(userJid);
    const next = {
      polishLevel:            parsed.data.polishLevel            !== undefined ? parsed.data.polishLevel            : existing?.polishLevel            ?? null,
      tone:                   parsed.data.tone                   !== undefined ? parsed.data.tone                   : existing?.tone                   ?? null,
      sourceLanguageHint:     parsed.data.sourceLanguageHint     !== undefined ? parsed.data.sourceLanguageHint     : existing?.sourceLanguageHint     ?? null,
      voiceTranslate:         parsed.data.voiceTranslate         !== undefined ? parsed.data.voiceTranslate         : existing?.voiceTranslate         ?? null,
      showSourceLabel:        parsed.data.showSourceLabel        !== undefined ? parsed.data.showSourceLabel        : existing?.showSourceLabel        ?? null,
      showProcessingReaction: parsed.data.showProcessingReaction !== undefined ? parsed.data.showProcessingReaction : existing?.showProcessingReaction ?? null,
    };
    repo.upsertUser(userJid, next);

    return c.json({ ok: true, overrides: next });
  });

  return r;
}
