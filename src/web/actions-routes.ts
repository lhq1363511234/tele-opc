import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repositories } from '../db/repositories.js';
import type { ApprovalService } from '../approvals/service.js';

const leadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().max(160).optional(),
  interest: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1).max(4000)
});

const financeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transaction'),
    direction: z.enum(['income', 'expense']),
    amount: z.number().positive().max(1_000_000_000),
    currency: z.string().trim().min(1).max(8).default('CNY'),
    counterparty: z.string().trim().max(160).optional(),
    category: z.string().trim().max(80).optional(),
    description: z.string().trim().min(1).max(2000)
  }),
  z.object({
    kind: z.literal('invoice'),
    customerName: z.string().trim().min(1).max(160),
    amount: z.number().positive().max(1_000_000_000),
    currency: z.string().trim().min(1).max(8).default('CNY'),
    status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).default('sent'),
    dueAt: z.string().trim().max(40).optional(),
    description: z.string().trim().min(1).max(2000)
  }),
  z.object({
    kind: z.literal('subscription'),
    vendorName: z.string().trim().min(1).max(160),
    amount: z.number().positive().max(1_000_000_000),
    currency: z.string().trim().min(1).max(8).default('CNY'),
    interval: z.string().trim().min(1).max(40).default('monthly'),
    nextBillingAt: z.string().trim().max(40).optional(),
    category: z.string().trim().max(80).optional(),
    description: z.string().trim().min(1).max(2000)
  })
]);

const calendarSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: z.string().trim().min(1).max(40),
  endsAt: z.string().trim().min(1).max(40),
  attendees: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).default(''),
  needsPrep: z.boolean().default(false)
});

const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'])
});

export function registerBusinessActionRoutes(
  app: FastifyInstance<any, any, any, any>,
  repos: Repositories,
  approvalService: ApprovalService,
  allowWebConsoleAccess: any
) {
  const opts = { preHandler: allowWebConsoleAccess };

  app.post<{ Body: unknown }>('/api/web/crm/leads', opts, async (request, reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_lead', issues: parsed.error.issues };
    }
    const result = await repos.createCrmLead(parsed.data);
    return { ok: true, ...result };
  });

  app.post<{ Body: unknown }>('/api/web/finance/entries', opts, async (request, reply) => {
    const parsed = financeSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_finance_entry', issues: parsed.error.issues };
    }
    const result = await repos.createFinanceEntry(parsed.data as never);
    return { ok: true, ...result };
  });

  app.post<{ Body: unknown }>('/api/web/calendar/events', opts, async (request, reply) => {
    const parsed = calendarSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_calendar_event', issues: parsed.error.issues };
    }
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      reply.code(400);
      return { ok: false, error: 'invalid_time_range' };
    }
    const result = await repos.createCalendarEntry({
      ...parsed.data,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    });
    return { ok: true, ...result };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/web/approvals/:id/decide',
    opts,
    async (request, reply) => {
      const parsed = approvalDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { ok: false, error: 'invalid_decision', issues: parsed.error.issues };
      }
      const existing = await repos.getApproval(request.params.id);
      if (!existing) {
        reply.code(404);
        return { ok: false, error: 'approval_not_found' };
      }
      const result = await approvalService.decide({
        id: request.params.id,
        status: parsed.data.decision === 'approved' ? 'approved' : 'rejected',
        userId: 'web_console',
        actorType: 'web_console'
      });
      return { ok: true, message: result };
    }
  );
}
