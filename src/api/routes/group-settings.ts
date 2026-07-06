import { Hono } from 'hono';
import { z } from 'zod';
import { repo } from '../../db/index.js';
import { getGroupMetadataCached, isGroupAdmin } from '../../wa/admin.js';
import type { AdminCtx } from '../index.js';

// Closed list of language codes the rest of the system understands. Keep in
// sync with src/translator/gemini.ts LANGUAGE_NAMES + web/app.js AVAILABLE_LANGUAGES.
const LANG_CODES = ['en', 'th', 'he', 'my', 'ms', 'tl', 'id', 'es', 'ru', 'zh', 'fr', 'de'] as const;

// Only the group knobs a WhatsApp group admin may touch. Cost/safety controls
// (enabled, budget, max audio length) and the approval flow stay Sean-only.
const patchSchema = z.object({
  targetLanguages: z.array(z.enum(LANG_CODES)).min(1).max(6).optional(),
  voiceTranslate: z.boolean().optional(),
  textTranslateOnMention: z.boolean().optional(),
  polishLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  showSourceLabel: z.boolean().optional(),
  showProcessingReaction: z.boolean().optional(),
});

export function groupSettingsRoutes(ctx: AdminCtx) {
  const r = new Hono();

  /**
   * Token is the first gate; live WhatsApp adminship is the second. A token
   * outlives a demotion, so every request re-checks the participant list —
   * a demoted admin's link dies within the metadata cache TTL.
   */
  async function authorize(token: string): Promise<
    | { ok: true; groupJid: string; subject: string | null }
    | { ok: false; status: 403 | 404 | 503; error: string }
  > {
    const info = repo.groupSettingsTokenInfo(token);
    if (!info) return { ok: false, status: 404, error: 'invalid or expired token' };
    if (!repo.getGroup(info.groupJid)) return { ok: false, status: 404, error: 'group no longer active' };

    try {
      const meta = await getGroupMetadataCached(ctx.sock(), info.groupJid);
      if (!isGroupAdmin(meta, info.userJid)) {
        return { ok: false, status: 403, error: 'you are no longer an admin of this group' };
      }
      return { ok: true, groupJid: info.groupJid, subject: meta.subject ?? null };
    } catch (err) {
      // Socket down (reconnect, admin-only mode) or metadata fetch failed.
      // Fail closed: no admin proof, no access.
      console.error('[api.g] admin verification unavailable', err);
      return { ok: false, status: 503, error: 'bot is offline, try again in a minute' };
    }
  }

  r.get('/:token/settings', async (c) => {
    const auth = await authorize(c.req.param('token'));
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const g = repo.getGroup(auth.groupJid)!;
    return c.json({
      groupName: auth.subject ?? g.label,
      settings: {
        targetLanguages: g.targetLanguages,
        voiceTranslate: g.voiceTranslate,
        textTranslateOnMention: g.textTranslateOnMention,
        polishLevel: g.polishLevel,
        showSourceLabel: g.showSourceLabel,
        showProcessingReaction: g.showProcessingReaction,
      },
    });
  });

  r.patch('/:token/settings', async (c) => {
    const auth = await authorize(c.req.param('token'));
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'validation failed', detail: parsed.error.flatten() }, 400);

    const g = repo.getGroup(auth.groupJid)!;
    const next = {
      ...g,
      targetLanguages: parsed.data.targetLanguages ? [...new Set(parsed.data.targetLanguages)] : g.targetLanguages,
      voiceTranslate: parsed.data.voiceTranslate ?? g.voiceTranslate,
      textTranslateOnMention: parsed.data.textTranslateOnMention ?? g.textTranslateOnMention,
      polishLevel: parsed.data.polishLevel ?? g.polishLevel,
      showSourceLabel: parsed.data.showSourceLabel ?? g.showSourceLabel,
      showProcessingReaction: parsed.data.showProcessingReaction ?? g.showProcessingReaction,
    };
    repo.upsertGroup(next);
    console.log(`[api.g] group settings updated for ${auth.groupJid}`);

    return c.json({
      ok: true,
      settings: {
        targetLanguages: next.targetLanguages,
        voiceTranslate: next.voiceTranslate,
        textTranslateOnMention: next.textTranslateOnMention,
        polishLevel: next.polishLevel,
        showSourceLabel: next.showSourceLabel,
        showProcessingReaction: next.showProcessingReaction,
      },
    });
  });

  return r;
}
