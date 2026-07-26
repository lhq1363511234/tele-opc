import { loadConfig } from '../src/config/index.js';
import { pool } from '../src/db/pool.js';
import { Repositories } from '../src/db/repositories.js';
import { FeishuBaseClient } from '../src/appos/feishu/base-client.js';
import { analyticsFactToFeishuFields } from '../src/appos/feishu/ledger-mappers.js';

/**
 * Fast path for bulk seed facts:
 * 1) page existing Feishu analytics ids into a Set
 * 2) batch_create only missing rows (no per-row search upsert)
 */
const config = loadConfig();
const repos = new Repositories(pool);

async function main() {
  if (!config.feishu.appId || !config.feishu.appSecret || !config.feishu.baseAppToken) {
    throw new Error('Feishu credentials missing');
  }
  const client = new FeishuBaseClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appToken: config.feishu.baseAppToken,
    baseUrl: config.feishu.openBaseUrl
  });

  const existing = new Set<string>();
  let token: string | undefined;
  let pages = 0;
  for (let page = 0; page < 80; page += 1) {
    const result = await client.listRecords('AnalyticsFacts', { pageSize: 500, pageToken: token });
    pages += 1;
    for (const item of result.items) {
      const id = item.fields?.id;
      if (typeof id === 'string' && id) existing.add(id);
    }
    if (!result.hasMore || !result.pageToken) break;
    token = result.pageToken;
  }

  const facts = await repos.listBusinessAnalyticsFacts(5000);
  const missing = facts.filter((fact) => !existing.has(fact.id));
  const batchSize = 100;
  let created = 0;
  let failed = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (let i = 0; i < missing.length; i += batchSize) {
    const chunk = missing.slice(i, i + batchSize);
    try {
      const fieldsList = chunk.map((fact) => analyticsFactToFeishuFields(fact));
      const records = await client.batchCreateRecords('AnalyticsFacts', fieldsList);
      created += records.length || chunk.length;
      console.log(JSON.stringify({
        progress: true,
        batch: Math.floor(i / batchSize) + 1,
        createdBatch: records.length || chunk.length,
        createdTotal: created,
        remaining: Math.max(0, missing.length - i - chunk.length)
      }));
      // gentle pacing against Feishu rate limits
      await new Promise((r) => setTimeout(r, 250));
    } catch (error) {
      failed += chunk.length;
      const message = error instanceof Error ? error.message : String(error);
      for (const fact of chunk) errors.push({ id: fact.id, message });
      console.error(JSON.stringify({ progress: true, batchFailed: true, message, at: i }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    existing: existing.size,
    localFacts: facts.length,
    missing: missing.length,
    created,
    failed,
    pagesScanned: pages,
    errors: errors.slice(0, 10)
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
