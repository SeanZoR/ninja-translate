import { startWAClient, type WAClient } from './wa/client.js';
import { handleMessage } from './wa/handler.js';
import { startAdminServer } from './api/index.js';

const ADMIN_ONLY = process.env.NINJA_ADMIN_ONLY === '1';

async function main() {
  let client: WAClient | null = null;

  if (ADMIN_ONLY) {
    console.log('[main] NINJA_ADMIN_ONLY=1 - skipping WhatsApp client (admin API + playground only)');
  } else {
    client = await startWAClient(
      {
        onConnected: (jid) => {
          console.log(`[main] bot online as ${jid}`);
        },
      },
      async (sock, msg) => {
        await handleMessage(sock, msg, {
          getBotJid: () => client?.botJid ?? null,
          getBotLid: () => client?.botLid ?? null,
        });
      },
    );
  }

  await startAdminServer({
    sock: () => {
      if (!client) throw new Error('WhatsApp client not running (admin-only mode?)');
      return client.sock();
    },
    getBotJid: () => client?.botJid ?? null,
  });

  process.on('SIGINT', async () => {
    console.log('[main] shutting down');
    await client?.shutdown().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[main] fatal', err);
  process.exit(1);
});
