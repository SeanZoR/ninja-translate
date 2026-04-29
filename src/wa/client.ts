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
  /** Returns the currently-active socket (changes across reconnects). */
  sock(): WASocket;
  botJid: string | null;
  shutdown: () => Promise<void>;
};

export type WAClientOptions = {
  showQrInTerminal?: boolean;
  onConnected?: (botJid: string) => void;
  /** When true, the client exits the run-loop after first successful connection
   *  and one disconnect (used by the QR pairing script so it doesn't infinite-reconnect). */
  exitOnFirstClose?: boolean;
};

/**
 * Starts a self-reconnecting WA client. Only ONE socket is active at a time -
 * we await the disconnect promise before creating a new socket. Avoids the 440
 * "stream replaced" ping-pong loop you get when you let multiple sockets share
 * the same auth state.
 */
export async function startWAClient(
  opts: WAClientOptions = {},
  onMessage?: (sock: WASocket, msg: any) => Promise<void>,
): Promise<WAClient> {
  fs.mkdirSync(config.sessionDir, { recursive: true });

  let currentSock: WASocket | null = null;
  let botJid: string | null = config.botJid;
  let stopped = false;

  // Run forever in the background, replacing the socket on each disconnect.
  void (async () => {
    while (!stopped) {
      const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[wa] using WA Web version ${version.join('.')} (isLatest=${isLatest})`);

      const sock = makeWASocket({
        version,
        auth: state,
        logger,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });
      currentSock = sock;

      sock.ev.on('creds.update', saveCreds);

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

      // Wait for this socket's lifecycle to end (either disconnect or graceful stop).
      const reason = await new Promise<{ code: number | undefined; shouldReconnect: boolean }>(
        (resolve) => {
          sock.ev.on('connection.update', (u: Partial<ConnectionState>) => {
            const { connection, lastDisconnect, qr } = u;
            if (qr && opts.showQrInTerminal) {
              qrcode.generate(qr, { small: true });
              console.log('\nScan the QR above with WhatsApp on the bot phone.\n');
            }
            if (connection === 'open') {
              const meId = sock.user?.id;
              if (meId) {
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
              resolve({ code, shouldReconnect });
            }
          });
        },
      );

      // Tear down old listeners cleanly so the next iteration starts fresh.
      try { sock.ev.removeAllListeners('connection.update'); } catch { /* ignore */ }
      try { sock.ev.removeAllListeners('messages.upsert'); } catch { /* ignore */ }
      try { sock.ev.removeAllListeners('creds.update'); } catch { /* ignore */ }
      try { sock.end(undefined as any); } catch { /* ignore */ }
      currentSock = null;

      if (!reason.shouldReconnect) {
        console.log('[wa] not reconnecting (logged out)');
        return;
      }
      if (opts.exitOnFirstClose) {
        console.log('[wa] exitOnFirstClose set - stopping after this disconnect');
        return;
      }
      // Brief backoff before reconnect.
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();

  // Wait briefly so callers see currentSock populated for first dispatch.
  for (let i = 0; i < 50 && !currentSock; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    sock: () => currentSock as WASocket,
    get botJid() { return botJid; },
    shutdown: async () => {
      stopped = true;
      try { await currentSock?.logout(); } catch { /* ignore */ }
    },
  };
}

export function sessionDir(): string {
  return config.sessionDir;
}

export function audioPath(groupJid: string, messageId: string): string {
  const dir = path.join(config.audioDir, groupJid.replace(/[^A-Za-z0-9_.-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${messageId}.ogg`);
}
