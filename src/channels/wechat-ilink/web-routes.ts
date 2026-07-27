import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import { pool } from '../../db/pool.js';
import { WechatLoginService } from './login-service.js';
import { WechatIlinkClient } from './api-client.js';
import { WechatIlinkStore } from './store.js';

export function registerWechatIlinkWebRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repos: Repositories,
  allowAccess: preHandlerHookHandler
) {
  app.get('/api/web/wechat/status', { preHandler: allowAccess }, async () => {
    if (!config.wechatIlink.enabled) return { ok: true, enabled: false, replyMode: config.wechatIlink.replyMode, accounts: [] };
    const store = new WechatIlinkStore(pool, config.app.encryptionKey);
    return { ok: true, enabled: true, replyMode: config.wechatIlink.replyMode, accounts: await store.listAccounts() };
  });

  app.post('/api/web/wechat/login/start', { preHandler: allowAccess }, async (_request, reply) => {
    if (!config.wechatIlink.enabled) {
      reply.code(409);
      return { ok: false, error: 'wechat_ilink_disabled' };
    }
    const service = new WechatLoginService(new WechatIlinkStore(pool, config.app.encryptionKey), repos, new WechatIlinkClient(config.wechatIlink.baseUrl));
    return { ok: true, ...(await service.start()) };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/web/wechat/login/:id/poll',
    { preHandler: allowAccess },
    async (request, reply) => {
      const parsed = z.object({ verifyCode: z.string().regex(/^\d{1,8}$/).optional() }).safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_verify_code' };
      }
      const service = new WechatLoginService(new WechatIlinkStore(pool, config.app.encryptionKey), repos, new WechatIlinkClient(config.wechatIlink.baseUrl));
      return { ok: true, ...(await service.poll(request.params.id, parsed.data.verifyCode)) };
    }
  );
}
