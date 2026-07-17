import pino from 'pino';
import { loadConfig } from './config/index.js';

const config = loadConfig();

export const logger = pino({
  level: config.app.logLevel,
  base: {
    service: config.app.name,
    env: config.app.env
  }
});

