import { Hono } from 'hono';
import type { AdminCtx } from '../index.js';

export function systemRoutes(ctx: AdminCtx) {
  const r = new Hono();

  r.get('/', (c) => {
    return c.json({
      botJid: ctx.getBotJid(),
      now: new Date().toISOString(),
    });
  });

  return r;
}
