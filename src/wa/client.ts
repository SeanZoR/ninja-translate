import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from '../config.js';

const logger = pino({ level: 'warn' });

export type WAClient = {
  sock: WASocket;
  botJid: string | null;
  shutdown: () => Promise<void>;
};

export type WAClientOptions = {
  showQrInTerminal?: boolean;
  onConnected?: (botJid: string) => void;
};

export async function startWAClient(
  opts: WAClientOptions = {},
  onMessage?: (sock: WASocket, msg: any) => Promise<void>,
): Promise<WAClient> {
  fs.mkdirSync(config.sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

  // Pin to whatever WA Web version is current right now. Without this, Baileys
  // uses a hardcoded version that WA rejects with 405 once they ship updates.
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[wa] using WA Web version ${version.join('.')} (isLatest=${isLatest})`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  let botJid: string | null = config.botJid;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && opts.showQrInTerminal) {
      qrcode.generate(qr, { small: true });
      console.log('\nScan the QR above with WhatsApp on the bot phone.\n');
    }
    if (connection === 'open') {
      const meId = sock.user?.id;
      if (meId) {
        // Baileys gives e.g. "15551234567:12@s.whatsapp.net" - normalize to bare jid.
        botJid = meId.split(':')[0]!.split('@')[0]! + '@s.whatsapp.net';
        console.log(`[wa] connected as ${botJid}`);
        opts.onConnected?.(botJid);
      }
    }
    if (connection === 'close') {
      const err: any = lastDisconnect?.error;
      const code: number | undefined = err?.output?.statusCode ?? err?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.error(`[wa] disconnected (code ${code}). reconnect=${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => startWAClient(opts, onMessage), 2000);
      }
    }
  });

  if (onMessage) {
    sock.ev.on('messages.upsert', async ({ messages }: { messages: any[] }) => {
      for (const m of messages) {
        if (!m.message) continue;
        if (m.key.fromMe) continue;
        try {
          await onMessage(sock, m);
        } catch (err) {
          console.error('[handler error]', err);
        }
      }
    });
  }

  return {
    sock,
    get botJid() { return botJid; },
    shutdown: async () => {
      try { await sock.logout(); } catch { /* ignore */ }
    },
  } as WAClient;
}

export function sessionDir(): string {
  return config.sessionDir;
}

export function audioPath(groupJid: string, messageId: string): string {
  const dir = path.join(config.audioDir, groupJid.replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${messageId}.ogg`);
}
