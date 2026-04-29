import { Hono } from 'hono';
import { z } from 'zod';
import { openMode } from '../../db/index.js';
import type { AdminCtx } from '../index.js';

export function systemRoutes(ctx: AdminCtx) {
  const r = new Hono();

  r.get('/', (c) => {
    return c.json({
      botJid: ctx.getBotJid(),
      now: new Date().toISOString(),
      openMode: {
        enabled: openMode.isEnabled(),
        defaultLanguages: openMode.defaultLanguages(),
      },
    });
  });

  // Open-mode controls. DANGER: when enabled, any WhatsApp group that adds
  // the bot gets auto-approved with default settings and the bot starts
  // translating immediately. Use only for testing.
  r.put('/open-mode', async (c) => {
    const body = await c.req.json();
    const schema = z.object({
      enabled: z.boolean(),
      defaultLanguages: z.array(z.string().length(2)).min(1).optional(),
    });
    const args = schema.parse(body);
    openMode.setEnabled(args.enabled);
    if (args.defaultLanguages) openMode.setDefaultLanguages(args.defaultLanguages);
    return c.json({
      enabled: openMode.isEnabled(),
      defaultLanguages: openMode.defaultLanguages(),
    });
  });

  return r;
}
