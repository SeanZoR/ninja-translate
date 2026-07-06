import type { GroupMetadata, WASocket } from '@whiskeysockets/baileys';

// Group metadata is fetched from WhatsApp and rate-limited server-side, so we
// cache briefly. 60s is short enough that a demoted admin loses access almost
// immediately, long enough that a settings-page session doesn't re-fetch on
// every PATCH.
const META_TTL_MS = 60_000;
const metaCache = new Map<string, { at: number; meta: GroupMetadata }>();

export async function getGroupMetadataCached(sock: WASocket, groupJid: string): Promise<GroupMetadata> {
  const hit = metaCache.get(groupJid);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const meta = await sock.groupMetadata(groupJid);
  metaCache.set(groupJid, { at: Date.now(), meta });
  return meta;
}

/**
 * True when `userJid` is a WhatsApp admin (or superadmin) of the group.
 * Participants can be addressed in LID form (@lid) or phone form
 * (@s.whatsapp.net) depending on the group's addressing mode; Baileys exposes
 * both aliases on each participant, so we match against all of them.
 */
export function isGroupAdmin(meta: GroupMetadata, userJid: string): boolean {
  const p = meta.participants.find(
    (p) => p.id === userJid || p.lid === userJid || p.phoneNumber === userJid,
  );
  if (!p) return false;
  return p.admin === 'admin' || p.admin === 'superadmin' || !!p.isAdmin || !!p.isSuperAdmin;
}
