import { Hono } from 'hono';
import { repo } from '../../db/index.js';
import type { AdminCtx } from '../index.js';

export function messagesRoutes(_ctx: AdminCtx) {
  const r = new Hono();

  r.get('/:jid', (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const rows = repo.listMessages(jid, limit, offset).map((m: any) => ({
      ...m,
      translations: m.translations ? JSON.parse(m.translations) : null,
    }));
    return c.json({ messages: rows, limit, offset });
  });

  return r;
}
