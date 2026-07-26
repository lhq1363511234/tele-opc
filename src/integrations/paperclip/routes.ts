import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import { logger } from '../../logger.js';
import { BullMqTaskDispatcher } from '../../queue/taskQueue.js';
import { PaperclipBridge } from './bridge.js';

const heartbeatSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  companyId: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional()
}).passthrough();

function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = request.headers['x-paperclip-secret'];
  return Array.isArray(header) ? header[0] : header;
}

const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled']);

async function waitForTaskTerminal(repos: Repositories, taskId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let task = await repos.getTask(taskId);
  while (task && !TERMINAL_TASK_STATUSES.has(task.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    task = await repos.getTask(taskId);
  }
  return task;
}

function authorize(request: FastifyRequest, reply: FastifyReply, config: AppConfig) {
  if (!config.paperclip.enabled) {
    reply.code(503).send({ ok: false, error: 'paperclip_integration_disabled' });
    return false;
  }
  if (!config.paperclip.webhookSecret) {
    reply.code(503).send({ ok: false, error: 'paperclip_webhook_secret_missing' });
    return false;
  }
  const token = bearer(request) ?? '';
  if (!safeEqual(token, config.paperclip.webhookSecret)) {
    reply.code(401).send({ ok: false, error: 'invalid_paperclip_webhook_secret' });
    return false;
  }
  return true;
}

export function registerPaperclipRoutes(app: FastifyInstance<any, any, any, any>, config: AppConfig, repos: Repositories) {
  const bridge = new PaperclipBridge(config, repos, new BullMqTaskDispatcher(config.redis.url));

  app.get('/api/integrations/paperclip/health', async () => ({
    ok: true,
    enabled: config.paperclip.enabled,
    configured: Boolean(config.paperclip.apiUrl && config.paperclip.webhookSecret),
    apiUrl: config.paperclip.apiUrl || null,
    mode: 'paperclip-control-plane__tele-opc-execution-plane',
    heartbeatWaitMs: config.paperclip.heartbeatWaitMs
  }));

  app.post('/api/integrations/paperclip/heartbeat', async (request, reply) => {
    if (!authorize(request, reply, config)) return;
    const parsed = heartbeatSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_paperclip_heartbeat', details: parsed.error.issues };
    }
    try {
      const accepted = await bridge.acceptHeartbeat(parsed.data);
      const task = await waitForTaskTerminal(repos, accepted.task.id, config.paperclip.heartbeatWaitMs);
      const terminal = Boolean(task && TERMINAL_TASK_STATUSES.has(task.status));

      // Keep the HTTP adapter run open until fast tasks reach a terminal state. Paperclip
      // otherwise classifies an immediate 202 as "no concrete action" and schedules a
      // duplicate recovery heartbeat. Long-running tasks still fall back to async mode.
      if (task?.status === 'done') await bridge.syncTaskResult(task, 'done', task.result ?? 'completed');
      if (task?.status === 'failed') await bridge.syncTaskResult(task, 'failed', task.result ?? 'failed');

      reply.code(terminal ? 200 : 202);
      return {
        ok: true,
        accepted: true,
        runId: parsed.data.runId,
        taskId: accepted.task.id,
        created: accepted.created,
        status: task?.status ?? accepted.task.status,
        terminal
      };
    } catch (error) {
      logger.error({ runId: parsed.data.runId, agentId: parsed.data.agentId, error: error instanceof Error ? error.message : String(error) }, 'Paperclip heartbeat bridge failed');
      reply.code(502);
      return { ok: false, error: 'paperclip_heartbeat_bridge_failed', runId: parsed.data.runId };
    }
  });
}
