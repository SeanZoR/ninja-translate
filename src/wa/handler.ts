import { downloadMediaMessage, type WAMessage, type WASocket } from '@whiskeysockets/baileys';
import fs from 'node:fs';
import { repo, openMode, type Group } from '../db/index.js';
import { translate, flagFor, type TranslateOptions } from '../translator/gemini.js';
import { audioPath } from './client.js';
import { alert } from '../alerts.js';
import { config } from '../config.js';

const budgetAlerted = new Map<string, string>(); // group_jid → YYYY-MM
const dmReplied = new Map<string, number>();    // user_jid → epoch ms of last DM reply

const REACT_PROCESSING = '🌐';
const REACT_TOO_LONG = '⏱️';
const REACT_BUDGET = '💸';
const REACT_ERROR = '⚠️';

const DM_RATE_LIMIT_MS = 30_000;

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
  if (remoteJid.endsWith('@s.whatsapp.net')) {
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

  // Budget guard: check this month's cost first.
  const monthCents = repo.monthCostForGroup(remoteJid);
  if (monthCents >= group.monthlyBudgetCents) {
    await react(sock, msg, REACT_BUDGET);
    const month = new Date().toISOString().slice(0, 7);
    if (budgetAlerted.get(remoteJid) !== month) {
      budgetAlerted.set(remoteJid, month);
      void alert(
        `Group "${group.label}" hit monthly budget cap ` +
        `(${monthCents.toFixed(2)}¢ / ${group.monthlyBudgetCents}¢). Pausing translations until next month or cap raise.`,
      );
    }
    return;
  }

  const voice = messageContent.audioMessage;
  const text = messageContent.conversation
    ?? messageContent.extendedTextMessage?.text
    ?? null;

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

  if (text && group.textTranslateOnMention) {
    const botJid = ctx.getBotJid();
    const botLid = ctx.getBotLid?.() ?? null;
    if (!botJid && !botLid) return;
    const mentions =
      messageContent.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    const wasMentioned = mentions.some((m) =>
      (botJid && m === botJid) || (botLid && m === botLid),
    );
    if (!wasMentioned) {
      console.log(`[wa.recv] text ignored (no mention; mentions=${JSON.stringify(mentions)} bot=${botJid}/${botLid})`);
      return;
    }
    // Strip @<digits> mention placeholders so Gemini doesn't echo them back
    // verbatim in the translation. Removes both @<bare-digits> and any nearby
    // whitespace/punctuation so the cleaned text reads naturally.
    const cleanText = text.replace(/@\d{6,}\s*/g, '').trim();
    if (!cleanText) {
      console.log('[wa.recv] text ignored (only mention, no body)');
      return;
    }
    await handleText(sock, msg, group, cleanText, { senderJid, senderName, waMessageId });
    return;
  }
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

  const audioBase64 = buffer.toString('base64');
  const mimeType = audio.mimetype ?? 'audio/ogg';

  let result;
  try {
    result = await translate(
      { kind: 'voice', audioBase64, mimeType },
      effectiveOptions(group, meta.senderJid),
    );
  } catch (err) {
    console.error('[gemini]', err);
    await react(sock, msg, REACT_ERROR);
    return;
  }

  await persistAndReply(sock, msg, group, {
    kind: 'voice',
    audioSeconds,
    senderJid: meta.senderJid,
    senderName: meta.senderName,
    waMessageId: meta.waMessageId,
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

  await sock.sendMessage(group.jid, { text: reply }, { quoted: msg });
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
 * Any DM to the bot triggers an auto-reply with the user's magic settings link.
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
  const body =
    `🥷 Your Ninja Translate settings — these follow you to every group:\n${url}\n\n` +
    `(link is private to you, valid for 30 days)`;
  try {
    await sock.sendMessage(userJid, { text: body });
    console.log(`[wa.dm] settings link sent to ${userJid}`);
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
