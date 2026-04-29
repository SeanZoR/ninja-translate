import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../src/config.js';

/**
 * Nightly backup. Tarballs:
 *   - ~/.ninja-translate/data.db       (SQLite)
 *   - ~/.ninja-translate/wa-session/   (Baileys session - losing this = forced re-pair)
 *   - ~/.ninja-translate/audio/        (last 7 days only, optional)
 *
 * Uploads to Cloudflare R2 with date-stamped key. R2 lifecycle policy on the
 * bucket keeps last 30 days.
 *
 * Schedule via cron (on VPS):
 *   30 3 * * *  ninja  cd /opt/ninja-translate && doppler run -- pnpm backup
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var for backup: ${name}`);
  return v;
}

async function main() {
  const bucket = required('R2_BUCKET');
  const accountId = required('R2_ACCOUNT_ID');
  const accessKeyId = required('R2_ACCESS_KEY_ID');
  const secretAccessKey = required('R2_SECRET_ACCESS_KEY');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tarPath = path.join('/tmp', `ninja-translate-${stamp}.tar.gz`);

  const inputs: string[] = [];
  if (fs.existsSync(config.dbPath)) inputs.push(config.dbPath);
  if (fs.existsSync(config.sessionDir)) inputs.push(config.sessionDir);

  // Audio: only files modified in last 7 days
  if (fs.existsSync(config.audioDir)) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent: string[] = [];
    function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && fs.statSync(p).mtimeMs >= cutoff) recent.push(p);
      }
    }
    walk(config.audioDir);
    inputs.push(...recent);
  }

  if (inputs.length === 0) {
    console.error('[backup] nothing to back up');
    process.exit(1);
  }

  // Build the tarball.
  const result = spawnSync('tar', ['-czf', tarPath, ...inputs], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('[backup] tar failed');
    process.exit(1);
  }

  const body = fs.readFileSync(tarPath);
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const key = `ninja-translate/${stamp}.tar.gz`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }),
  );
  fs.unlinkSync(tarPath);
  console.log(`[backup] uploaded ${key} (${(body.byteLength / 1024).toFixed(1)} KiB)`);
}

main().catch((err) => {
  console.error('[backup] failed', err);
  process.exit(1);
});
