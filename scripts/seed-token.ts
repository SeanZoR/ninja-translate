import { repo } from '../src/db/index.js';
const TEST_JID = process.argv[2] ?? 'test-user@s.whatsapp.net';
const t = repo.getOrCreateSettingsToken(TEST_JID);
console.log(JSON.stringify({ jid: TEST_JID, ...t }, null, 2));
