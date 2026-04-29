import { startWAClient } from './wa/client.js';
import { handleMessage } from './wa/handler.js';
import { startAdminServer } from './api/index.js';

const ADMIN_ONLY = process.env.NINJA_ADMIN_ONLY === '1';

async function main() {
  let getBotJid: () => string | null = () => null;

  const adminCtx = {
    sock: null as any,
    getBotJid: () => getBotJid(),
  };

  if (ADMIN_ONLY) {
    console.log('[main] NINJA_ADMIN_ONLY=1 - skipping WhatsApp client (admin API + playground only)');
  } else {
    const client = await startWAClient(
      {
        onConnected: (jid) => {
          console.log(`[main] bot online as ${jid}`);
        },
      },
      async (sock, msg) => {
        adminCtx.sock = sock;
        await handleMessage(sock, msg, { getBotJid });
      },
    );

    getBotJid = () => client.botJid;
    adminCtx.sock = client.sock;
  }

  await startAdminServer(adminCtx);

  process.on('SIGINT', async () => {
    console.log('[main] shutting down');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[main] fatal', err);
  process.exit(1);
});
