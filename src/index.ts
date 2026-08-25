import 'dotenv/config';
import { initDatabase } from './database';
import { bot1 } from './bots/bot1';
import { bot2 } from './bots/bot2';

const required = ['BOT1_TOKEN', 'BOT2_TOKEN', 'OWNER_ID', 'ENCRYPTION_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

if (process.env.ENCRYPTION_KEY!.length !== 64) {
  console.error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  process.exit(1);
}

async function main() {
  console.log('Starting Dual-Bot System (Educational)...');
  initDatabase();

  await Promise.all([
    bot1.login(process.env.BOT1_TOKEN),
    bot2.login(process.env.BOT2_TOKEN),
  ]);

  console.log('Both bots are online.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
