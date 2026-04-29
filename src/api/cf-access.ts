import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { config } from '../config.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    if (!config.cfAccessTeamDomain) throw new Error('CF_ACCESS_TEAM_DOMAIN missing');
    const url = new URL(`https://${config.cfAccessTeamDomain}/cdn-cgi/access/certs`);
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

/**
 * Verifies the Cf-Access-Jwt-Assertion header (or CF_Authorization cookie)
 * against the team's JWKS and the configured AUD tag. Sets the verified
 * claims on c.var.cfAccessClaims.
 *
 * Bypasses verification entirely when CF_ACCESS_AUD is unset (local dev).
 */
export const requireCfAccess: MiddlewareHandler = async (c, next) => {
  if (!config.cfAccessAud) return next();

  const headerJwt = c.req.header('Cf-Access-Jwt-Assertion');
  const cookieJwt = c.req.header('cookie')?.match(/CF_Authorization=([^;]+)/)?.[1];
  const token = headerJwt ?? cookieJwt;
  if (!token) return c.json({ error: 'cf-access: missing token' }, 401);

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://${config.cfAccessTeamDomain}`,
      audience: config.cfAccessAud,
    });
    c.set('cfAccessClaims', payload);
    return next();
  } catch (err) {
    return c.json({ error: 'cf-access: invalid token', detail: String(err) }, 401);
  }
};
