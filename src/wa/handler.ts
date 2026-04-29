import { downloadMediaMessage, type WAMessage, type WASocket } from '@whiskeysockets/baileys';
import fs from 'node:fs';
import { config } from '../config.js';
import { repo, type Group } from '../db/index.js';
import { translate, flagFor } from '../translator/gemini.js';
import { audioPath } from './client.js';

const REACT_PROCESSING = '🌐';
const REACT_TOO_LONG = '⏱️';
const REACT_BUDGET = '💸';
const REACT_ERROR = '⚠️';

export type HandlerCtx = {
  getBotJid: () => string | null;
};

export async function handleMessage(sock: WASocket, msg: WAMessage, ctx: HandlerCtx): Promise<void> {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid || !remoteJid.endsWith('@g.us')) return; // groups only

  const messageContent = msg.message;
  if (!messageContent) return;

  const senderJid = msg.key.participant ?? msg.participant ?? null;
  const senderName = msg.pushName ?? null;
  const waMessageId = msg.key.id ?? `${Date.now()}`;

  const group = repo.getGroup(remoteJid);
  if (!group) {
    await trackPending(sock, remoteJid, msg, senderJid, senderName);
    return;
  }
  if (!group.enabled) return;

  // Budget guard: check this month's cost first.
  const monthCents = repo.monthCostForGroup(remoteJid);
  if (monthCents >= group.monthlyBudgetCents) {
    await react(sock, msg, REACT_BUDGET);
    return;
  }

  const voice = messageContent.audioMessage;
  const text = messageContent.conversation
    ?? messageContent.extendedTextMessage?.text
    ?? null;

  if (voice && group.voiceTranslate) {
    await handleVoice(sock, msg, group, ctx, { senderJid, senderName, waMessageId });
    return;
  }

  if (text && group.textTranslateOnMention) {
    const botJid = ctx.getBotJid();
    if (!botJid) return;
    const mentions =
      messageContent.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    if (!mentions.includes(botJid)) return;
    await handleText(sock, msg, group, text, { senderJid, senderName, waMessageId });
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

  if (group.showProcessingReaction) {
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
      {
        targetLanguages: group.targetLanguages,
        conciseMode: group.conciseMode,
        showSourceLabel: group.showSourceLabel,
      },
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
  if (group.showProcessingReaction) {
    await react(sock, msg, REACT_PROCESSING);
  }

  let result;
  try {
    result = await translate(
      { kind: 'text', text },
      {
        targetLanguages: group.targetLanguages,
        conciseMode: group.conciseMode,
        showSourceLabel: group.showSourceLabel,
      },
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

  const reply = formatReply(group, result);
  if (!reply) return;

  await sock.sendMessage(group.jid, { text: reply }, { quoted: msg });
}

function formatReply(group: Group, result: Awaited<ReturnType<typeof translate>>): string | null {
  if (Object.keys(result.translations).length === 0 && !result.sourceText) {
    return '[unintelligible]';
  }

  const lines: string[] = [];
  if (group.showSourceLabel && result.sourceLang) {
    lines.push(`[lang: ${result.sourceLang}]`);
  }
  if (!group.conciseMode && result.sourceText) {
    lines.push(result.sourceText);
    lines.push('---');
  }
  for (const lang of group.targetLanguages) {
    if (lang === result.sourceLang) continue;
    const t = result.translations[lang];
    if (t) lines.push(`${flagFor(lang)} ${t}`);
  }
  return lines.join('\n');
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
