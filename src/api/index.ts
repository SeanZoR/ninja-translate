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
  const webRootRel = path.relative(process.cwd(), webRoot) || './web';
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

  // Public-page static assets — always served, even in production, since the
  // public hostname doesn't go through CF Pages. Whitelist explicit files so
  // we don't accidentally expose the admin dashboard (index.html, app.js) on
  // the un-gated hostname. Direct readFileSync rather than serveStatic — the
  // latter's mount-point semantics don't match what we need here and the
  // payload is tiny.
  const PUBLIC_FILES: Record<string, string> = {
    '/styles.css': 'text/css; charset=utf-8',
    '/u.css': 'text/css; charset=utf-8',
    '/u.js': 'application/javascript; charset=utf-8',
  };
  for (const [route, contentType] of Object.entries(PUBLIC_FILES)) {
    const filename = route.slice(1);
    app.get(route, (c) => {
      try {
        const body = fs.readFileSync(path.join(webRoot, filename));
        return c.body(body, 200, { 'Content-Type': contentType });
      } catch {
        return c.text('not found', 404);
      }
    });
  }
  // /assets/* — currently just videos. Look up the file safely (no path
  // traversal) and serve with a guessed content type.
  app.get('/assets/*', (c) => {
    const rel = c.req.path.replace(/^\/assets\//, '');
    if (rel.includes('..') || rel.startsWith('/')) return c.text('not found', 404);
    try {
      const body = fs.readFileSync(path.join(webRoot, 'assets', rel));
      const ext = path.extname(rel).toLowerCase();
      const ct =
        ext === '.mp4' ? 'video/mp4' :
        ext === '.webm' ? 'video/webm' :
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        'application/octet-stream';
      return c.body(body, 200, { 'Content-Type': ct });
    } catch {
      return c.text('not found', 404);
    }
  });

  // Local-dev convenience: expose the full web/ tree at the same origin so
  // the admin dashboard works without CF Pages. In production CF Pages serves
  // the dashboard, so we don't enable the catch-all there.
  if (!config.cfAccessAud) {
    app.use(
      '/*',
      serveStatic({
        root: webRootRel,
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
