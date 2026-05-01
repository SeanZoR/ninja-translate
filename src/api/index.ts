import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
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
import { userSettingsRoutes } from './routes/user-settings.js';

export type AdminCtx = {
  /** Returns the current Baileys socket. May change across reconnects. */
  sock: () => WASocket;
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
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    }),
  );

  // CF Access gate, but skip for the public per-user settings endpoints.
  // The token in the URL path is the auth — these are intentionally reachable
  // without a CF Access cookie, served from a separate public hostname in prod.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/u/')) return next();
    return requireCfAccess(c, next);
  });

  app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  app.route('/api/groups', groupsRoutes(ctx));
  app.route('/api/inbox', inboxRoutes(ctx));
  app.route('/api/messages', messagesRoutes(ctx));
  app.route('/api/usage', usageRoutes(ctx));
  app.route('/api/system', systemRoutes(ctx));
  app.route('/api/playground', playgroundRoutes(ctx));
  app.route('/api/u', userSettingsRoutes());

  // Public per-user settings page. Token in path is the auth. Renders the
  // same HTML for any token; the page reads location.pathname client-side and
  // calls /api/u/:token/me. If the token is unknown/expired we still serve
  // the page — it'll show an "expired link" state from the API 404.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.resolve(__dirname, '../../web');
  const userPagePath = path.join(webRoot, 'u.html');
  app.get('/u/:token', (c) => {
    try {
      const html = fs.readFileSync(userPagePath, 'utf8');
      return c.html(html);
    } catch (err) {
      console.error('[api] failed to read u.html', err);
      return c.text('settings page unavailable', 500);
    }
  });

  // Local-dev convenience: serve the static dashboard from web/ at the same origin
  // when CF Access is not configured. In production CF Pages serves the dashboard.
  if (!config.cfAccessAud) {
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
