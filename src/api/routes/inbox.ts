import { Hono } from 'hono';
import { z } from 'zod';
import { repo } from '../../db/index.js';
import { leaveGroup } from '../../wa/groups.js';
import type { AdminCtx } from '../index.js';

export function inboxRoutes(ctx: AdminCtx) {
  const r = new Hono();

  r.get('/', (c) => {
    const pending = repo.listPending().map((p: any) => ({
      jid: p.jid,
      subject: p.subject,
      participants: p.participants ? JSON.parse(p.participants) : [],
      inviterJid: p.inviter_jid,
      inviterName: p.inviter_name,
      sampleMessages: p.sample_messages ? JSON.parse(p.sample_messages) : [],
      firstSeenAt: p.first_seen_at,
    }));
    return c.json({ pending });
  });

  const approveSchema = z.object({
    label: z.string().min(1),
    targetLanguages: z.array(z.string().length(2)).min(1),
    polishLevel: z.number().int().min(0).max(3).optional(),
    showSourceLabel: z.boolean().optional(),
    showProcessingReaction: z.boolean().optional(),
    maxAudioSeconds: z.number().int().positive().optional(),
    monthlyBudgetCents: z.number().int().nonnegative().optional(),
    notes: z.string().nullable().optional(),
  });

  r.post('/:jid/approve', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const body = await c.req.json();
    const args = approveSchema.parse(body);

    repo.upsertGroup({
      jid,
      label: args.label,
      targetLanguages: args.targetLanguages,
      enabled: true,
      voiceTranslate: true,
      textTranslateOnMention: true,
      polishLevel: args.polishLevel ?? 1,
      showSourceLabel: args.showSourceLabel ?? true,
      showProcessingReaction: args.showProcessingReaction ?? false,
      maxAudioSeconds: args.maxAudioSeconds ?? 600,
      monthlyBudgetCents: args.monthlyBudgetCents ?? 500,
      createdByNinja: false,
      autoApproved: false,
      inviteLink: null,
      notes: args.notes ?? null,
      lastTranslatedAt: null,
      createdAt: new Date().toISOString(),
    });
    repo.deletePending(jid);
    return c.json({ group: repo.getGroup(jid) });
  });

  r.post('/:jid/reject', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const body = await c.req.json().catch(() => ({}));
    const reason = (body as any)?.reason ?? null;
    const inviter = repo.getPending(jid)?.inviter_jid ?? null;

    try {
      await leaveGroup(ctx.sock(), jid);
    } catch (err) {
      console.error('[api] leaveGroup failed during reject', err);
    }
    repo.reject(jid, inviter, reason);
    return c.json({ ok: true });
  });

  r.delete('/:jid', (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    repo.deletePending(jid);
    return c.json({ ok: true });
  });

  return r;
}
