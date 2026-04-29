import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import type { WASocket } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { requireCfAccess } from './cf-access.js';
import { groupsRoutes } from './routes/groups.js';
import { inboxRoutes } from './routes/inbox.js';
import { messagesRoutes } from './routes/messages.js';
import { usageRoutes } from './routes/usage.js';
import { systemRoutes } from './routes/system.js';
import { playgroundRoutes } from './routes/playground.js';

export type AdminCtx = {
  sock: WASocket;
  getBotJid: () => string | null;
};

export async function startAdminServer(ctx: AdminCtx): Promise<void> {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: config.apiAllowedOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Cf-Access-Jwt-Assertion'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use('/api/*', requireCfAccess);

  app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  app.route('/api/groups', groupsRoutes(ctx));
  app.route('/api/inbox', inboxRoutes(ctx));
  app.route('/api/messages', messagesRoutes(ctx));
  app.route('/api/usage', usageRoutes(ctx));
  app.route('/api/system', systemRoutes(ctx));
  app.route('/api/playground', playgroundRoutes(ctx));

  serve({
    fetch: app.fetch,
    hostname: config.adminHost,
    port: config.adminPort,
  });
  console.log(
    `[admin] listening on http://${config.adminHost}:${config.adminPort} ` +
    `(allowed origins: ${config.apiAllowedOrigins.join(', ')})`,
  );
}
