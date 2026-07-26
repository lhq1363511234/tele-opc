import { loadConfig } from '../src/config/index.js';
import { Repositories } from '../src/db/repositories.js';
import { pool } from '../src/db/pool.js';
import { buildFeishuMirror } from '../src/appos/feishu/ledger-mirror.js';
import { LedgerSync } from '../src/appos/feishu/ledger-sync.js';

const config = loadConfig();
const repos = new Repositories(pool);

async function main() {
  const mirror = buildFeishuMirror({
    publicBaseUrl: config.app.publicBaseUrl,
    appId: config.feishu.appId || undefined,
    appSecret: config.feishu.appSecret || undefined,
    appToken: config.feishu.baseAppToken || undefined,
    baseUrl: config.feishu.openBaseUrl
  });
  const summary = await new LedgerSync(repos, mirror).run({
    taskLimit: 100, approvalLimit: 100, leadLimit: 100, artifactLimit: 100, analyticsLimit: 2500
  });
  console.log(JSON.stringify({ ok: true, mode: summary.mode, analytics: summary.counts.analytics, errors: summary.errors.filter((item) => item.kind === 'analytics') }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
