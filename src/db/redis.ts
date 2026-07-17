import { Redis } from 'ioredis';
import { loadConfig } from '../config/index.js';

const config = loadConfig();

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null
});

export async function pingRedis() {
  const result = await redis.ping();
  return result === 'PONG';
}
