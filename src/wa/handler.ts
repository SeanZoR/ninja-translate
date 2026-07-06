import { downloadMediaMessage, type GroupMetadata, type WAMessage, type WASocket } from '@whiskeysockets/baileys';
import fs from 'node:fs';
import { repo, openMode, type Group } from '../db/index.js';
import { translate, flagFor, type TranslateOptions } from '../translator/gemini.js';
import { audioPath } from './client.js';
import { getGroupMetadataCached, isGroupAdmin } from './admin.js';
import { alert } from '../alerts.js';
import { config } from '../config.js';

const budgetAlerted = new Map<string, string>(); // group_jid → YYYY-MM
const dmReplied = new Map<string, number>();    // user_jid → epoch ms of last DM reply

// Voice notes forwarded as a batch arrive as separate WA messages with no
// "these belong together" marker. We debounce per (group, sender): each clip
// resets a short window, and when it elapses the whole batch goes through ONE
// Gemini call → one combined transcript + translation reply.
const VOICE_BATCH_WINDOW_MS = 2000;
// Flush early past this many clips — bounds the inline audio payload (Gemini
// caps requests around 20MB) and the worst-case merge size.
const VOICE_BATCH_MAX_CLIPS = 10;

type BufferedClip = {
  msg: WAMessage;
  audioBase64: string;
  mimeType: string;
  audioSeconds: number | null;
  waMessageId: string;
};

type PendingBatch = {
  sock: WASocket;
  group: Group;
  senderJid: string | null;
  senderName: string | null;
  clips: BufferedClip[];
  timer: NodeJS.Timeout;
};

const voiceBatches = new Map<string, PendingBatch>(); // `${groupJid}|${senderJid}`

const REACT_PROCESSING = '🌐';
const REACT_TOO_LONG = '⏱️';
const REACT_BUDGET = '💸';
const REACT_ERROR = '⚠️';

const DM_RATE_LIMIT_MS = 30_000;

// "@bot language" (or "settings") from a group admin → DM them a magic link
// to this group's settings page. Single memorable word, checked after mention
// placeholders are stripped so it must be the entire message body.
const SETTINGS_COMMAND_RE = /^(language|languages|settings?)$/i;

/**
 * Merges per-user overrides onto the group config for the speaker. Group is the
 * single source of truth for `targetLanguages` (per-user fan-out would silently
 * break group expectations for other readers).
 */
function effectiveOptions(group: Group, speakerJid: string | null): TranslateOptions {
  const u = speakerJid ? repo.getUser(speakerJid) : null;
  return {
    targetLanguages: group.targetLanguages,
    polishLevel: u?.polishLevel ?? group.polishLevel,
    showSourceLabel: u?.showSourceLabel ?? group.showSourceLabel,
    tone: u?.tone ?? undefined,
    sourceLanguageHint: u?.sourceLanguageHint ?? undefined,
  };
}

function effectiveProcessingReaction(group: Group, speakerJid: string | null): boolean {
  const u = speakerJid ? repo.getUser(speakerJid) : null;
  return u?.showProcessingReaction ?? group.showProcessingReaction;
}

function publicUserBaseUrl(): string {
  return config.publicUserBaseUrl ?? `http://${config.adminHost}:${config.adminPort}`;
}

/**
 * True when the group has hit its monthly budget cap. Reacts 💸 on `msg` and
 * fires a once-per-month admin alert.
 */
async function overBudget(sock: WASocket, msg: WAMessage, group: Group): Promise<boolean> {
  const monthCents = repo.monthCostForGroup(group.jid);
  if (monthCents < group.monthlyBudgetCents) return false;
  await react(sock, msg, REACT_BUDGET);
  const month = new Date().toISOString().slice(0, 7);
  if (budgetAlerted.get(group.jid) !== month) {
    budgetAlerted.set(group.jid, month);
    void alert(
      `Group "${group.label}" hit monthly budget cap ` +
      `(${monthCents.toFixed(2)}¢ / ${group.monthlyBudgetCents}¢). Pausing translations until next month or cap raise.`,
    );
  }
  return true;
}

type QuotedMessage = NonNullable<WAMessage['message']>;

/**
 * Pulls a translatable text payload out of a quoted message. Returns null for
 * voice / sticker / location / etc. — quote-translate is text-only for now.
 */
function quotedTextFrom(quoted: QuotedMessage): string | null {
  const t =
    quoted.conversation
    ?? quoted.extendedTextMessage?.text
    ?? quoted.imageMessage?.caption
    ?? quoted.videoMessage?.caption
    ?? quoted.documentMessage?.caption
    ?? null;
  const trimmed = t?.trim();
  return trimmed ? trimmed : null;
}

export type HandlerCtx = {
  getBotJid: () => string | null;
  /** LID-form JID for the bot's identity in modern WA mentions. */
  getBotLid?: () => string | null;
};

export async function handleMessage(sock: WASocket, msg: WAMessage, ctx: HandlerCtx): Promise<void> {
  const remoteJid = msg.key.remoteJid;
  const kind = msg.message?.audioMessage ? 'voice'
    : msg.message?.conversation || msg.message?.extendedTextMessage?.text ? 'text'
    : 'other';
  console.log(`[wa.recv] from=${remoteJid} sender=${msg.key.participant ?? msg.participant ?? '?'} kind=${kind} fromMe=${msg.key.fromMe}`);
  if (!remoteJid) return;
  // DMs land on @s.whatsapp.net (legacy phone-form JID) or @lid (modern
  // privacy-form). Either way, they aren't a group, and we want to reply
  // with the settings link.
  if (remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid')) {
    await handleDirectMessage(sock, remoteJid, msg);
    return;
  }
  if (!remoteJid.endsWith('@g.us')) return;

  const messageContent = msg.message;
  if (!messageContent) return;

  const senderJid = msg.key.participant ?? msg.participant ?? null;
  const senderName = msg.pushName ?? null;
  const waMessageId = msg.key.id ?? `${Date.now()}`;

  let group = repo.getGroup(remoteJid);
  if (!group) {
    if (openMode.isEnabled() && !repo.isRejected(remoteJid)) {
      group = await autoApproveForOpenMode(sock, remoteJid);
    } else {
      await trackPending(sock, remoteJid, msg, senderJid, senderName);
      return;
    }
  }
  if (!group.enabled) return;

  const voice = messageContent.audioMessage;
  // Pull text from plain text messages AND from media captions (image/video/
  // document). Media captions carry their own contextInfo for mentions.
  const textSource = textSourceFrom(messageContent);

  const wasMentioned = textSource ? botWasMentioned(textSource, ctx) : false;
  // Strip @<digits> mention placeholders so what's left is just the message
  // body — used both for the settings command match and for translation.
  const cleanText = textSource ? textSource.text.replace(/@\d{6,}\s*/g, '').trim() : '';

  // Group-admin settings command. Sits before the budget guard and the
  // textTranslateOnMention gate on purpose: admins should always be able to
  // reach their settings page, even in a capped or mention-disabled group.
  if (wasMentioned && SETTINGS_COMMAND_RE.test(cleanText)) {
    await handleGroupSettingsCommand(sock, msg, group, senderJid);
    return;
  }

  // Budget guard: check this month's cost first.
  if (await overBudget(sock, msg, group)) return;

  if (voice && group.voiceTranslate) {
    // Per-user opt-out: speaker explicitly disabled voice translation for their
    // own messages. Group must allow first; user can only narrow, not widen.
    const userVoice = senderJid ? repo.getUser(senderJid)?.voiceTranslate : null;
    if (userVoice === false) {
      console.log(`[wa.recv] voice skipped (user opt-out senderJid=${senderJid})`);
      return;
    }
    await handleVoice(sock, msg, group, ctx, { senderJid, senderName, waMessageId });
    return;
  }

  if (textSource && group.textTranslateOnMention) {
    if (!wasMentioned) {
      console.log(`[wa.recv] text ignored (no mention; source=${textSource.source} mentions=${JSON.stringify(textSource.contextInfo?.mentionedJid ?? [])})`);
      return;
    }
    let translateText = cleanText;
    if (!translateText) {
      // Mention-only reply: translate the quoted message instead.
      const quoted = textSource.contextInfo?.quotedMessage;
      const quotedText = quoted ? quotedTextFrom(quoted) : null;
      if (!quotedText) {
        console.log('[wa.recv] text ignored (only mention, no body, no quotable text)');
        return;
      }
      console.log('[wa.recv] text mention with empty body → translating quoted message');
      translateText = quotedText;
    }
    await handleText(sock, msg, group, translateText, { senderJid, senderName, waMessageId });
    return;
  }
}

type TextSource = {
  text: string;
  source: 'conversation' | 'extendedText' | 'imageCaption' | 'videoCaption' | 'documentCaption';
  contextInfo: { mentionedJid?: string[] | null; quotedMessage?: QuotedMessage | null } | null | undefined;
};

function botWasMentioned(textSource: TextSource, ctx: HandlerCtx): boolean {
  const botJid = ctx.getBotJid();
  const botLid = ctx.getBotLid?.() ?? null;
  const mentions = textSource.contextInfo?.mentionedJid ?? [];
  return mentions.some((m) => (botJid && m === botJid) || (botLid && m === botLid));
}

/**
 * Surfaces translatable text from any message type that can carry one — plain
 * text, extended text, or image/video/document captions. Returns the matching
 * contextInfo so mentions and quoted-message fallback work for captions too.
 */
function textSourceFrom(content: NonNullable<WAMessage['message']>): TextSource | null {
  if (content.conversation) {
    return { text: content.conversation, source: 'conversation', contextInfo: null };
  }
  if (content.extendedTextMessage?.text) {
    return {
      text: content.extendedTextMessage.text,
      source: 'extendedText',
      contextInfo: content.extendedTextMessage.contextInfo,
    };
  }
  if (content.imageMessage?.caption) {
    return {
      text: content.imageMessage.caption,
      source: 'imageCaption',
      contextInfo: content.imageMessage.contextInfo,
    };
  }
  if (content.videoMessage?.caption) {
    return {
      text: content.videoMessage.caption,
      source: 'videoCaption',
      contextInfo: content.videoMessage.contextInfo,
    };
  }
  if (content.documentMessage?.caption) {
    return {
      text: content.documentMessage.caption,
      source: 'documentCaption',
      contextInfo: content.documentMessage.contextInfo,
    };
  }
  return null;
}

async function handleVoice(
  sock: WASocket,
  msg: WAMessage,
  group: Group,
  _ctx: HandlerCtx,
  meta: { senderJid: string | null; senderName: string | null; waMessageId: string },
): Promise<void> {
  const audio = msg.message?.audioMessage;
  if (!audio) return;

  const audioSeconds = audio.seconds ?? null;
  if (audioSeconds && audioSeconds > group.maxAudioSeconds) {
    await react(sock, msg, REACT_TOO_LONG);
    return;
  }

  if (effectiveProcessingReaction(group, meta.senderJid)) {
    await react(sock, msg, REACT_PROCESSING);
  }

  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
  } catch (err) {
    console.error('[wa] media download failed', err);
    await react(sock, msg, REACT_ERROR);
    return;
  }

  // Persist a copy for debugging / audit (auto-cleaned by retention job).
  try {
    fs.writeFileSync(audioPath(group.jid, meta.waMessageId), buffer);
  } catch { /* non-fatal */ }

  const clip: BufferedClip = {
    msg,
    audioBase64: buffer.toString('base64'),
    mimeType: audio.mimetype ?? 'audio/ogg',
    audioSeconds,
    waMessageId: meta.waMessageId,
  };

  // No sender identity → no safe way to merge across messages; flush alone.
  const key = `${group.jid}|${meta.senderJid ?? meta.waMessageId}`;

  const existing = voiceBatches.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.clips.push(clip);
    if (existing.clips.length >= VOICE_BATCH_MAX_CLIPS) {
      console.log(`[wa.voice] batch cap reached (${existing.clips.length} clips) → flushing key=${key}`);
      void flushVoiceBatch(key);
      return;
    }
    existing.timer = setTimeout(() => void flushVoiceBatch(key), VOICE_BATCH_WINDOW_MS);
    console.log(`[wa.voice] buffered clip ${existing.clips.length} for key=${key}`);
    return;
  }

  voiceBatches.set(key, {
    sock,
    group,
    senderJid: meta.senderJid,
    senderName: meta.senderName,
    clips: [clip],
    timer: setTimeout(() => void flushVoiceBatch(key), VOICE_BATCH_WINDOW_MS),
  });
}

async function flushVoiceBatch(key: string): Promise<void> {
  const batch = voiceBatches.get(key);
  if (!batch) return;
  // Remove BEFORE the async work so clips arriving mid-flush start a fresh batch.
  voiceBatches.delete(key);
  clearTimeout(batch.timer);

  const { sock, group, clips } = batch;
  const lastClip = clips[clips.length - 1]!;
  if (clips.length > 1) {
    console.log(`[wa.voice] flushing batch of ${clips.length} clips for key=${key}`);
  }

  // Re-check the budget: the pre-buffer check in handleMessage ran per clip,
  // but the month's spend may have crossed the cap while we were buffering.
  if (await overBudget(sock, lastClip.msg, group)) return;

  let result;
  try {
    result = await translate(
      { kind: 'voice', clips: clips.map((c) => ({ audioBase64: c.audioBase64, mimeType: c.mimeType })) },
      effectiveOptions(group, batch.senderJid),
    );
  } catch (err) {
    console.error('[gemini]', err);
    for (const c of clips) await react(sock, c.msg, REACT_ERROR);
    return;
  }

  // One DB row + one reply per batch: quote the LAST clip, sum the durations.
  const totalSeconds = clips.reduce<number | null>(
    (sum, c) => (c.audioSeconds == null ? sum : (sum ?? 0) + c.audioSeconds),
    null,
  );
  await persistAndReply(sock, lastClip.msg, group, {
    kind: 'voice',
    audioSeconds: totalSeconds,
    senderJid: batch.senderJid,
    senderName: batch.senderName,
    waMessageId: lastClip.waMessageId,
    result,
  });
}

async function handleText(
  sock: WASocket,
  msg: WAMessage,
  group: Group,
  text: string,
  meta: { senderJid: string | null; senderName: string | null; waMessageId: string },
): Promise<void> {
  if (effectiveProcessingReaction(group, meta.senderJid)) {
    await react(sock, msg, REACT_PROCESSING);
  }

  let result;
  try {
    result = await translate(
      { kind: 'text', text },
      effectiveOptions(group, meta.senderJid),
    );
  } catch (err) {
    console.error('[gemini]', err);
    await react(sock, msg, REACT_ERROR);
    return;
  }

  await persistAndReply(sock, msg, group, {
    kind: 'text',
    audioSeconds: null,
    senderJid: meta.senderJid,
    senderName: meta.senderName,
    waMessageId: meta.waMessageId,
    result,
  });
}

async function persistAndReply(
  sock: WASocket,
  msg: WAMessage,
  group: Group,
  args: {
    kind: 'voice' | 'text';
    audioSeconds: number | null;
    senderJid: string | null;
    senderName: string | null;
    waMessageId: string;
    result: Awaited<ReturnType<typeof translate>>;
  },
): Promise<void> {
  const { result } = args;

  repo.insertMessage({
    groupJid: group.jid,
    waMessageId: args.waMessageId,
    senderJid: args.senderJid,
    senderName: args.senderName,
    kind: args.kind,
    sourceLang: result.sourceLang,
    sourceText: result.sourceText,
    translations: result.translations,
    audioSeconds: args.audioSeconds,
    geminiTokensIn: result.tokensIn,
    geminiTokensOut: result.tokensOut,
    costCents: result.costCents,
  });
  repo.touchGroup(group.jid);

  const reply = formatReply(group, result, args.kind);
  if (!reply) return;

  // linkPreview:null skips baileys' URL-preview generation (which needs the
  // optional link-preview-js peer dep we don't install) - no card, no warning.
  await sock.sendMessage(group.jid, { text: reply, linkPreview: null }, { quoted: msg });
}

function formatReply(
  group: Group,
  result: Awaited<ReturnType<typeof translate>>,
  kind: 'voice' | 'text',
): string | null {
  if (Object.keys(result.translations).length === 0 && !result.sourceText) {
    return '[unintelligible]';
  }

  const lines: string[] = [];

  for (const lang of group.targetLanguages) {
    if (lang === result.sourceLang) continue;
    const t = result.translations[lang];
    if (t) lines.push(`${flagFor(lang)} ${t}`);
  }

  // Source line goes LAST and only for voice messages (so the speaker can
  // verify the transcription - polished per polishLevel). Text @mentions skip
  // it since the user already sees their own message above the bot's quoted
  // reply.
  if (kind === 'voice' && result.sourceLang && result.sourceText) {
    lines.push(`${flagFor(result.sourceLang)} ${result.sourceText}`);
  }

  return lines.join('\n');
}

/**
 * "@bot language" inside a group. WhatsApp adminship is the whole permission
 * model: admins get a group-scoped magic link DM'd to them, everyone else
 * gets a 🔒 react. The link edits only this group, and the API re-verifies
 * adminship on every call, so a demoted admin's link stops working.
 */
async function handleGroupSettingsCommand(
  sock: WASocket,
  msg: WAMessage,
  group: Group,
  senderJid: string | null,
): Promise<void> {
  if (!senderJid) return;

  let meta: GroupMetadata | null = null;
  try {
    meta = await getGroupMetadataCached(sock, group.jid);
  } catch (err) {
    console.error('[wa.cmd] groupMetadata failed', err);
  }
  if (!meta || !isGroupAdmin(meta, senderJid)) {
    console.log(`[wa.cmd] settings denied (not admin) sender=${senderJid} group=${group.jid}`);
    await react(sock, msg, '🔒');
    return;
  }

  const { token } = repo.getOrCreateGroupSettingsToken(group.jid, senderJid);
  const url = `${publicUserBaseUrl()}/g/${token}`;
  const name = meta.subject || group.label;
  try {
    await sock.sendMessage(senderJid, {
      text:
        `🥷 Group settings for *${name}*:\n${url}\n\n` +
        `(admin-only link — anyone with it can change this group's settings. Valid for 30 days.)`,
      linkPreview: null,
    });
    await react(sock, msg, '📬');
    console.log(`[wa.cmd] group settings link sent to ${senderJid} for ${group.jid}`);
  } catch (err) {
    // DM can fail if the admin's privacy settings block messages from
    // non-contacts. The 🔒-free react tells them *something* happened.
    console.error('[wa.cmd] failed to DM group settings link', err);
    await react(sock, msg, REACT_ERROR);
  }
}

/**
 * Enabled groups where `userJid` is a WhatsApp admin. Metadata fetches are
 * cached and failures are skipped — worst case a group is missing from the
 * DM list, and the in-group "@bot language" path still covers it.
 */
async function groupsWhereAdmin(
  sock: WASocket,
  userJid: string,
): Promise<{ group: Group; subject: string }[]> {
  const groups = repo.listGroups().filter((g) => g.enabled);
  const metas = await Promise.allSettled(groups.map((g) => getGroupMetadataCached(sock, g.jid)));
  const out: { group: Group; subject: string }[] = [];
  groups.forEach((group, i) => {
    const r = metas[i];
    if (!r || r.status !== 'fulfilled') return;
    if (isGroupAdmin(r.value, userJid)) {
      out.push({ group, subject: r.value.subject || group.label });
    }
  });
  return out;
}

/**
 * Any DM to the bot triggers an auto-reply with the user's magic settings link
 * — plus group-settings links for every group where they're a WhatsApp admin.
 * Idempotent: returns the same active token within its TTL, so the same URL
 * keeps working across multiple DMs. Rate-limited per-jid in-process to avoid
 * spamming when a user fires several messages in a row.
 */
async function handleDirectMessage(sock: WASocket, userJid: string, _msg: WAMessage): Promise<void> {
  const now = Date.now();
  const last = dmReplied.get(userJid) ?? 0;
  if (now - last < DM_RATE_LIMIT_MS) {
    console.log(`[wa.dm] rate-limited senderJid=${userJid} (${now - last}ms since last)`);
    return;
  }
  dmReplied.set(userJid, now);

  const { token } = repo.getOrCreateSettingsToken(userJid);
  const url = `${publicUserBaseUrl()}/u/${token}`;
  let body =
    `🥷 Your Ninja Translate settings — these follow you to every group:\n${url}\n\n` +
    `(link is private to you, valid for 30 days)`;

  const adminOf = await groupsWhereAdmin(sock, userJid).catch(() => []);
  if (adminOf.length > 0) {
    const lines = adminOf.map(({ group, subject }) => {
      const { token: gToken } = repo.getOrCreateGroupSettingsToken(group.jid, userJid);
      return `• ${subject}\n  ${publicUserBaseUrl()}/g/${gToken}`;
    });
    body +=
      `\n\n👑 You're an admin — group settings you can manage:\n${lines.join('\n')}\n\n` +
      `Tip: in any group, mention me with the word "language" to get that group's link.`;
  }

  try {
    await sock.sendMessage(userJid, { text: body, linkPreview: null });
    console.log(`[wa.dm] settings link sent to ${userJid} (adminOf=${adminOf.length})`);
  } catch (err) {
    console.error('[wa.dm] sendMessage failed', err);
  }
}

async function autoApproveForOpenMode(sock: WASocket, jid: string): Promise<Group> {
  let label = `(open mode) ${jid}`;
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta?.subject) label = `(open mode) ${meta.subject}`;
  } catch {
    /* metadata may not be available yet; fine */
  }
  const langs = openMode.defaultLanguages();
  const g: Group = {
    jid,
    label,
    targetLanguages: langs,
    enabled: true,
    voiceTranslate: true,
    textTranslateOnMention: true,
    polishLevel: 2,
    showSourceLabel: true,
    showProcessingReaction: false,
    maxAudioSeconds: 600,
    monthlyBudgetCents: 100, // tighter cap for unknown groups
    createdByNinja: false,
    autoApproved: true,
    inviteLink: null,
    notes: 'Auto-approved by open mode. Review and either keep or remove.',
    lastTranslatedAt: null,
    createdAt: new Date().toISOString(),
  };
  repo.upsertGroup(g);
  console.log(`[open-mode] auto-approved ${jid} as "${label}" with langs ${langs.join(',')}`);
  return g;
}

async function trackPending(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  inviterJid: string | null,
  inviterName: string | null,
): Promise<void> {
  if (repo.isRejected(jid)) return; // bot was rejected before; ignore silently

  let subject: string | null = null;
  let participants: string[] | null = null;
  try {
    const meta = await sock.groupMetadata(jid);
    subject = meta.subject;
    participants = meta.participants.map((p) => p.id);
  } catch {
    /* metadata not yet available, will fill in on next message */
  }

  const existing = repo.getPending(jid);
  const samples: any[] = existing?.sample_messages ? JSON.parse(existing.sample_messages) : [];
  const snippet =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    (msg.message?.audioMessage ? `[voice ${msg.message.audioMessage.seconds ?? '?'}s]` : null) ??
    '[other]';
  samples.push({
    at: new Date().toISOString(),
    senderName: msg.pushName,
    senderJid: msg.key.participant,
    snippet,
  });
  while (samples.length > 5) samples.shift();

  repo.upsertPending({
    jid,
    subject,
    participants,
    inviterJid,
    inviterName,
    sampleMessages: samples,
  });
}

async function react(sock: WASocket, msg: WAMessage, emoji: string): Promise<void> {
  if (!msg.key) return;
  try {
    await sock.sendMessage(msg.key.remoteJid!, {
      react: { text: emoji, key: msg.key },
    });
  } catch (err) {
    console.error('[react]', err);
  }
}
