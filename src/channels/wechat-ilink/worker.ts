import { loadConfig } from '../../config/index.js';
import { pool } from '../../db/pool.js';
import { Repositories } from '../../db/repositories.js';
import { logger } from '../../logger.js';
import { WechatIlinkPoller } from './poller.js';
import { WechatIlinkStore } from './store.js';

const config = loadConfig();
if (!config.wechatIlink.enabled) {
  logger.warn('WeChat iLink worker disabled');
  await pool.end();
  process.exit(0);
}
const repos = new Repositories(pool);
const store = new WechatIlinkStore(pool, config.app.encryptionKey);
const poller = new WechatIlinkPoller(config, repos, store);
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'WeChat iLink worker stopping');
  await poller.stop();
  await pool.end();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
logger.info('WeChat iLink worker started');
await poller.run();
