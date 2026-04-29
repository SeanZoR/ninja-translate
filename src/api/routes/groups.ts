import { Hono } from 'hono';
import { z } from 'zod';
import { repo } from '../../db/index.js';
import { createGroup, leaveGroup, regenerateInviteLink } from '../../wa/groups.js';
import type { AdminCtx } from '../index.js';

const groupSchema = z.object({
  jid: z.string(),
  label: z.string().min(1),
  targetLanguages: z.array(z.string().length(2)).min(1),
  enabled: z.boolean().default(true),
  voiceTranslate: z.boolean().default(true),
  textTranslateOnMention: z.boolean().default(true),
  conciseMode: z.boolean().default(false),
  showSourceLabel: z.boolean().default(true),
  showProcessingReaction: z.boolean().default(false),
  maxAudioSeconds: z.number().int().positive().default(600),
  monthlyBudgetCents: z.number().int().nonnegative().default(500),
  createdByNinja: z.boolean().default(false),
  autoApproved: z.boolean().default(false),
  inviteLink: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export function groupsRoutes(ctx: AdminCtx) {
  const r = new Hono();

  r.get('/', (c) => {
    const groups = repo.listGroups().map((g) => ({
      ...g,
      monthCostCents: repo.monthCostForGroup(g.jid),
    }));
    return c.json({ groups });
  });

  r.get('/:jid', (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const g = repo.getGroup(jid);
    if (!g) return c.json({ error: 'not found' }, 404);
    return c.json({
      group: g,
      monthCostCents: repo.monthCostForGroup(jid),
    });
  });

  r.put('/:jid', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const body = await c.req.json();
    const parsed = groupSchema.parse({ ...body, jid });
    repo.upsertGroup({
      ...parsed,
      lastTranslatedAt: null,
      createdAt: new Date().toISOString(),
    });
    return c.json({ group: repo.getGroup(jid) });
  });

  r.delete('/:jid', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const leaveOnDelete = c.req.query('leave') === 'true';
    if (leaveOnDelete) {
      try { await leaveGroup(ctx.sock(), jid); } catch (err) {
        console.error('[api] leaveGroup failed', err);
      }
    }
    repo.deleteGroup(jid);
    return c.json({ ok: true });
  });

  r.post('/:jid/regenerate-invite', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const link = await regenerateInviteLink(ctx.sock(), jid);
    const g = repo.getGroup(jid);
    if (g) repo.upsertGroup({ ...g, inviteLink: link });
    return c.json({ inviteLink: link });
  });

  // Secondary flow: Ninja creates a brand-new group.
  r.post('/create', async (c) => {
    const body = await c.req.json();
    const schema = z.object({
      subject: z.string().min(1),
      label: z.string().min(1),
      targetLanguages: z.array(z.string().length(2)).min(1),
      seedJid: z.string().min(3),
      seedShouldLeaveAfter: z.boolean().default(true),
    });
    const args = schema.parse(body);
    const created = await createGroup(ctx.sock(), {
      subject: args.subject,
      seedJid: args.seedJid,
      seedShouldLeaveAfter: args.seedShouldLeaveAfter,
    });
    repo.upsertGroup({
      jid: created.jid,
      label: args.label,
      targetLanguages: args.targetLanguages,
      enabled: true,
      voiceTranslate: true,
      textTranslateOnMention: true,
      conciseMode: false,
      showSourceLabel: true,
      showProcessingReaction: false,
      maxAudioSeconds: 600,
      monthlyBudgetCents: 500,
      createdByNinja: true,
      autoApproved: false,
      inviteLink: created.inviteLink,
      notes: null,
      lastTranslatedAt: null,
      createdAt: new Date().toISOString(),
    });
    return c.json({ jid: created.jid, inviteLink: created.inviteLink });
  });

  return r;
}
