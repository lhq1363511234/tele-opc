import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { MetaAgentEvolutionService } from './service.js';

const planSchema = z.object({
  requirement: z.string().trim().min(8).max(8000)
});

const runSchema = z.object({
  taskInput: z.string().trim().min(2).max(20000)
});

export function registerMetaAgentWebRoutes(
  app: FastifyInstance<any, any, any, any>,
  service: MetaAgentEvolutionService | null,
  auth: preHandlerHookHandler
) {
  app.get('/api/web/meta-agent', { preHandler: auth }, async (_request, reply) => {
    if (!service) return unavailable(reply);
    return { ok: true, dashboard: await service.dashboard() };
  });

  app.post('/api/web/meta-agent/blueprints', { preHandler: auth }, async (request, reply) => {
    if (!service) return unavailable(reply);
    const parsed = planSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_meta_agent_requirement', details: parsed.error.flatten() };
    }
    try {
      return { ok: true, ...(await service.plan(parsed.data.requirement)) };
    } catch (error) {
      reply.code(502);
      return { ok: false, error: 'meta_agent_plan_failed', message: errorMessage(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/web/meta-agent/blueprints/:id/rediscover', { preHandler: auth }, async (request, reply) => {
    if (!service) return unavailable(reply);
    try {
      return { ok: true, ...(await service.rediscover(request.params.id)) };
    } catch (error) {
      reply.code(errorMessage(error) === 'meta_agent_blueprint_not_found' ? 404 : 502);
      return { ok: false, error: 'meta_agent_rediscovery_failed', message: errorMessage(error) };
    }
  });

  app.post<{ Params: { id: string } }>('/api/web/meta-agent/blueprints/:id/run', { preHandler: auth }, async (request, reply) => {
    if (!service) return unavailable(reply);
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_meta_agent_task', details: parsed.error.flatten() };
    }
    try {
      return { ok: true, ...(await service.run(request.params.id, parsed.data.taskInput)) };
    } catch (error) {
      reply.code(errorMessage(error) === 'meta_agent_blueprint_not_found' ? 404 : 502);
      return { ok: false, error: 'meta_agent_run_failed', message: errorMessage(error) };
    }
  });

  app.get<{ Params: { id: string } }>('/api/web/meta-agent/runs/:id', { preHandler: auth }, async (request, reply) => {
    if (!service) return unavailable(reply);
    const detail = await service.runDetail(request.params.id);
    if (!detail) {
      reply.code(404);
      return { ok: false, error: 'meta_agent_run_not_found' };
    }
    return { ok: true, ...detail };
  });
}

function unavailable(reply: { code(status: number): unknown }) {
  reply.code(503);
  return { ok: false, error: 'meta_agent_model_unavailable', message: 'AI 模型未配置，无法规划或运行元智能体。' };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
