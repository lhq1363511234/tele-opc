import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppOSGatewayService } from './service.js';

const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');

export function registerAppOSGateway(app: FastifyInstance<any, any, any, any>, service: AppOSGatewayService) {
  app.post('/api/appos/contracts', async (request, reply) => {
    try {
      return { ok: true, ...(await service.createContract(request.body)) };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      throw error;
    }
  });

  app.post('/api/appos/events', async (request, reply) => {
    try {
      return { ok: true, event: await service.storeEvent(request.body) };
    } catch (error) {
      if (error instanceof ZodError) {
        reply.code(400);
        return { ok: false, error: formatZodError(error) };
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/api/appos/runs/:id', async (request, reply) => {
    const run = await service.getRun(request.params.id);
    if (!run) {
      reply.code(404);
      return { ok: false, error: 'workflow run not found' };
    }
    const events = await service.listEventsForRun(run.id);
    return { ok: true, run, events };
  });

  app.post<{
    Body: {
      runId: string;
      status: 'planned' | 'queued' | 'running' | 'waiting_callback' | 'reviewing' | 'done' | 'failed' | 'cancelled';
      output?: Record<string, unknown>;
      error?: { message?: string; [key: string]: unknown };
      externalExecutionId?: string;
    };
  }>('/api/appos/webhooks/n8n/run-callback', async (request, reply) => {
    const result = await service.updateRunFromN8nCallback(request.body);
    if (!result) {
      reply.code(404);
      return { ok: false, error: 'workflow run not found' };
    }
    return { ok: true, ...result };
  });
}
