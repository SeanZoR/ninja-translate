import { Hono } from 'hono';
import { z } from 'zod';
import { translate } from '../../translator/gemini.js';
import type { AdminCtx } from '../index.js';

const baseSchema = z.object({
  targetLanguages: z.array(z.string().length(2)).min(1).max(8),
  polishLevel: z.number().int().min(0).max(3).default(2),
  showSourceLabel: z.boolean().default(true),
});

const textSchema = baseSchema.extend({
  kind: z.literal('text'),
  text: z.string().min(1).max(4000),
});

const voiceSchema = baseSchema.extend({
  kind: z.literal('voice'),
  audioBase64: z.string().min(1),
  mimeType: z.string().default('audio/ogg'),
});

const playgroundSchema = z.union([textSchema, voiceSchema]);

/**
 * Run the translator without persisting anything. Useful for trying out
 * languages/flags interactively, calibrating the Burmese quality gate, and
 * verifying the parser / formatter end to end.
 */
export function playgroundRoutes(_ctx: AdminCtx) {
  const r = new Hono();

  r.post('/translate', async (c) => {
    const body = await c.req.json();
    const args = playgroundSchema.parse(body);

    const result =
      args.kind === 'text'
        ? await translate(
            { kind: 'text', text: args.text },
            {
              targetLanguages: args.targetLanguages,
              polishLevel: args.polishLevel,
              showSourceLabel: args.showSourceLabel,
            },
          )
        : await translate(
            { kind: 'voice', audioBase64: args.audioBase64, mimeType: args.mimeType },
            {
              targetLanguages: args.targetLanguages,
              polishLevel: args.polishLevel,
              showSourceLabel: args.showSourceLabel,
            },
          );

    return c.json({
      sourceLang: result.sourceLang,
      sourceText: result.sourceText,
      translations: result.translations,
      rendered: result.rendered,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costCents: result.costCents,
    });
  });

  return r;
}
