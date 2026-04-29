import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // Local-dev convenience: serve the static dashboard from web/ at the same origin
  // when CF Access is not configured. In production CF Pages serves the dashboard.
  if (!config.cfAccessAud) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(__dirname, '../../web');
    app.use(
      '/*',
      serveStatic({
        root: path.relative(process.cwd(), webRoot) || './web',
        rewriteRequestPath: (p) => (p === '/' ? '/index.html' : p),
      }),
    );
  }

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
