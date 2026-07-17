import Fastify from 'fastify';
import type { AppConfig } from './config/index.js';
import { logger } from './logger.js';
import { pingDatabase, pool } from './db/pool.js';
import { pingRedis } from './db/redis.js';
import { Repositories } from './db/repositories.js';
import { TelegramUpdateHandler } from './telegram/handler.js';
import type { TelegramUpdate } from './telegram/types.js';
import { registerWebConsole } from './webConsole.js';
import { registerAppOSGateway } from './appos/gateway/routes.js';
import { AppOSGatewayService } from './appos/gateway/service.js';
import { registerInbeidouCpsRoutes } from './appos/domains/cps/inbeidou-module.js';
import { registerMoboboostCpsRoutes } from './appos/domains/cps/moboboost-module.js';
import { registerDependencyRegistryRoutes } from './appos/dependencies/registry.js';

export function createApp(config: AppConfig) {
  const app = Fastify({
    loggerInstance: logger
  });

  const repos = new Repositories(pool);
  const telegramHandler = new TelegramUpdateHandler(config, repos);
  const appOSGateway = new AppOSGatewayService();
  registerWebConsole(app, config, repos);
  registerAppOSGateway(app, appOSGateway);
  registerDependencyRegistryRoutes(app);
  registerInbeidouCpsRoutes(app);
  registerMoboboostCpsRoutes(app);

  app.get('/health', async () => ({
    ok: true,
    service: config.app.name,
    env: config.app.env
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
      return { ok: database && redis, database, redis };
    } catch (error) {
      reply.code(503);
      return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
    }
  });

  app.post<{ Params: { secret?: string }; Body: TelegramUpdate }>(
    '/telegram/webhook/:secret',
    async (request, reply) => {
      if (config.telegram.webhookSecret && request.params.secret !== config.telegram.webhookSecret) {
        reply.code(401);
        return { ok: false, error: 'invalid webhook secret' };
      }
      void telegramHandler.handle(request.body).catch((error) => {
        logger.error(
          { updateId: request.body.update_id, error: error instanceof Error ? error.message : String(error) },
          'telegram webhook background handling failed'
        );
      });
      return { ok: true, accepted: true };
    }
  );

  app.post<{ Body: TelegramUpdate }>('/telegram/webhook', async (request, reply) => {
    const headerSecret = request.headers['x-telegram-bot-api-secret-token'];
    if (config.telegram.webhookSecret && headerSecret !== config.telegram.webhookSecret) {
      reply.code(401);
      return { ok: false, error: 'invalid webhook secret' };
    }
    void telegramHandler.handle(request.body).catch((error) => {
      logger.error(
        { updateId: request.body.update_id, error: error instanceof Error ? error.message : String(error) },
        'telegram webhook background handling failed'
      );
    });
    return { ok: true, accepted: true };
  });

  return app;
}
