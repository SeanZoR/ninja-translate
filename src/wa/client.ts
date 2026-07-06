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
import { alert } from '../alerts.js';

const logger = pino({ level: 'warn' });

export type WAClient = {
  /** Returns the currently-active socket (changes across reconnects). */
  sock(): WASocket;
  /** Bot's bare phone-based JID, e.g. "15551234567@s.whatsapp.net". */
  botJid: string | null;
  /** Bot's LID-form JID (used for @mentions in modern WhatsApp), e.g. "253451003011208@lid". */
  botLid: string | null;
  shutdown: () => Promise<void>;
};

/** Strip Baileys' device suffix from a JID: "X:NN@server" → "X@server". */
function stripDeviceSuffix(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const at = jid.indexOf('@');
  if (at < 0) return jid;
  const head = jid.slice(0, at).split(':')[0]!;
  return head + jid.slice(at);
}

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
  let botJid: string | null = stripDeviceSuffix(config.botJid);
  let botLid: string | null = null;
  let stopped = false;

  // Health alerting: count consecutive failed reconnects so a sustained outage
  // triggers exactly one alert, and the following successful open reports recovery.
  const OUTAGE_ALERT_AFTER = 5;
  let reconnectFailures = 0;
  let outageAlerted = false;

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
              const me = sock.user;
              const creds = (sock.authState as any)?.creds;
              const rawJid = me?.id ?? creds?.me?.id;
              const rawLid = (me as any)?.lid ?? creds?.me?.lid;
              botJid = stripDeviceSuffix(rawJid);
              botLid = stripDeviceSuffix(rawLid);
              if (botJid) {
                console.log(`[wa] connected as ${botJid} (lid=${botLid ?? 'none'})`);
                // Only ping recovery if we'd previously alerted about a sustained
                // outage — avoids spam on routine transient reconnects.
                if (outageAlerted) {
                  void alert(`✅ WhatsApp reconnected as ${botJid} — bot is back online.`);
                }
                reconnectFailures = 0;
                outageAlerted = false;
                opts.onConnected?.(botJid);
              }
            }
            if (connection === 'close') {
              const err: any = lastDisconnect?.error;
              const code: number | undefined = err?.output?.statusCode ?? err?.statusCode;
              const shouldReconnect = code !== DisconnectReason.loggedOut;
              console.error(`[wa] disconnected (code ${code}). reconnect=${shouldReconnect}`);
              if (!shouldReconnect) {
                // Logged out (code 401): Baileys will NOT reconnect. The bot is
                // dead until someone re-pairs a fresh QR. This is the failure
                // that can otherwise go unnoticed for weeks — alert loudly.
                void alert(
                  `⚠️ WhatsApp session LOGGED OUT (code ${code}). Bot is DOWN and needs a QR re-pair. ` +
                    `On the VPS: stop the service, clear wa-session, run the QR login, restart.`,
                );
              } else {
                // Recoverable drop. Count consecutive failures; if the bot can't
                // get back for a sustained stretch, alert once (and remember, so
                // the next successful open reports recovery).
                reconnectFailures++;
                if (reconnectFailures === OUTAGE_ALERT_AFTER && !outageAlerted) {
                  outageAlerted = true;
                  void alert(
                    `⚠️ WhatsApp has failed to reconnect ${reconnectFailures} times ` +
                      `(last code ${code}). Bot may be offline — check the VPS.`,
                  );
                }
              }
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
    get botLid() { return botLid; },
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
