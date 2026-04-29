import { Hono } from 'hono';
import { repo } from '../../db/index.js';
import type { AdminCtx } from '../index.js';

export function usageRoutes(_ctx: AdminCtx) {
  const r = new Hono();

  r.get('/this-month', (c) => {
    const rows = repo.monthCostAll();
    const total = rows.reduce((s, r) => s + r.total, 0);
    return c.json({ totalCents: total, perGroup: rows });
  });

  return r;
}
