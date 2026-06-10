// Entry point: `npm run inbox`. Local long polling — never deployed to Railway.
import 'dotenv/config';
import { buildBot } from './bot.js';

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`[intel-inbox] Missing ${key} — add it to tc-sva-bot/.env (local only, never Railway).`);
    process.exit(1);
  }
  return val;
}

const bot = buildBot({
  token: required('INTEL_BOT_TOKEN'),
  ownerId: Number(process.env.INTEL_OWNER_ID ?? '806982232'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    console.log(`\n[intel-inbox] ${sig} — stopping…`);
    void bot.stop();
  });
}

void bot.start({
  onStart: (me) => console.log(`[intel-inbox] polling as @${me.username} — forward promoter updates, Ctrl-C to stop`),
});
