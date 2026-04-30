import { startWAClient } from '../src/wa/client.js';

async function main() {
  console.log('[login] starting WhatsApp pairing flow');
  console.log('[login] session dir:', process.env.SESSION_DIR ?? '(default)');
  const client = await startWAClient({
    showQrInTerminal: true,
    exitOnFirstClose: false,
    onConnected: (jid) => {
      console.log(`\n[login] connected. BOT_JID=${jid}`);
      console.log('[login] add this to your env (e.g. .env): BOT_JID=' + jid);
      console.log('[login] you can now stop this script (Ctrl+C). Session is saved.');
    },
  });

  process.on('SIGINT', async () => {
    console.log('\n[login] exiting');
    await client.shutdown().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[login] fatal', err);
  process.exit(1);
});
