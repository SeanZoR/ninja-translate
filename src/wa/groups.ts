import type { WASocket } from '@whiskeysockets/baileys';

export type CreateGroupResult = {
  jid: string;
  subject: string;
  inviteLink: string;
  createdWith: string[];
};

/**
 * Create a new group. Default behavior is for users to add the bot to existing
 * groups - this is the secondary "Ninja creates the group" path used from the
 * dashboard for friends who want a fresh group.
 *
 * Baileys' groupCreate generally requires at least one participant besides
 * the bot. We accept a `seedJid` (Sean's personal number is a safe choice)
 * to bootstrap; `seedShouldLeaveAfter` defaults true so the seed exits and
 * only invitees end up in the final group.
 */
export async function createGroup(
  sock: WASocket,
  args: {
    subject: string;
    seedJid?: string | null;
    extraParticipants?: string[];
    seedShouldLeaveAfter?: boolean;
  },
): Promise<CreateGroupResult> {
  const seed = args.seedJid ? [args.seedJid] : [];
  const participants = [...seed, ...(args.extraParticipants ?? [])];

  if (participants.length === 0) {
    // Surface the constraint loudly rather than letting Baileys throw obscurely.
    throw new Error(
      'createGroup needs at least one participant besides the bot. ' +
      'Pass seedJid (e.g., Sean\'s personal WhatsApp JID).',
    );
  }

  const created = await sock.groupCreate(args.subject, participants);
  const jid = created.id;

  // Lock down: only admins can edit settings; anyone can speak.
  try {
    await sock.groupSettingUpdate(jid, 'locked');     // restrict info edits to admins
    await sock.groupSettingUpdate(jid, 'not_announcement'); // everyone can send
  } catch (err) {
    console.error('[wa] groupSettingUpdate failed', err);
  }

  const code = await sock.groupInviteCode(jid);
  const inviteLink = `https://chat.whatsapp.com/${code}`;

  if (args.seedShouldLeaveAfter !== false && args.seedJid) {
    try {
      await sock.groupParticipantsUpdate(jid, [args.seedJid], 'remove');
    } catch (err) {
      console.error('[wa] could not remove seed participant', err);
    }
  }

  return {
    jid,
    subject: args.subject,
    inviteLink,
    createdWith: participants,
  };
}

export async function leaveGroup(sock: WASocket, jid: string): Promise<void> {
  await sock.groupLeave(jid);
}

export async function regenerateInviteLink(sock: WASocket, jid: string): Promise<string> {
  const code = await sock.groupRevokeInvite(jid);
  return `https://chat.whatsapp.com/${code}`;
}
