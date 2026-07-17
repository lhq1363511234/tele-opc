import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { logger } from './logger.js';

const config = loadConfig();
const app = createApp(config);

try {
  await app.listen({ host: config.app.host, port: config.app.port });
  logger.info({ host: config.app.host, port: config.app.port }, 'Tele-OPC OS API started');
} catch (error) {
  logger.error({ error }, 'failed to start API');
  process.exit(1);
}

