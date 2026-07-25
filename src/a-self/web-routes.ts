import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repositories } from '../db/repositories.js';

const memorySchema = z.object({
  category: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(12000),
  why: z.string().trim().max(4000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  sensitivity: z.enum(['private', 'sensitive', 'public']).default('private'),
  confidence: z.number().min(0).max(1).optional()
});

const decisionSchema = z.object({
  decidedAt: z.string().trim().optional(),
  question: z.string().trim().min(1).max(1000),
  choice: z.string().trim().min(1).max(2000),
  why: z.string().trim().min(1).max(6000),
  result: z.string().trim().max(4000).optional(),
  review: z.string().trim().max(4000).optional(),
  futureRule: z.string().trim().max(2000).optional(),
  impact: z.enum(['unknown', 'low', 'medium', 'high', 'strategic']).default('unknown')
});

const opcRunSchema = z.object({
  runType: z.enum(['morning', 'evening', 'weekly', 'experiment']).default('morning'),
  title: z.string().trim().min(1).max(200),
  marketScan: z.string().trim().max(8000).optional(),
  companyState: z.string().trim().max(8000).optional(),
  recommendations: z.string().trim().max(8000).optional(),
  metrics: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  status: z.enum(['draft', 'ready', 'reviewed']).default('draft')
});

export function registerASelfWebRoutes(
  app: FastifyInstance<any, any, any, any>,
  repos: Repositories,
  allowWebConsoleAccess: any
) {
  const routeOptions = { preHandler: allowWebConsoleAccess };

  app.get('/api/web/a-self', routeOptions, async () => buildASelfDashboard(repos));

  app.post<{ Body: unknown }>('/api/web/a-self/memory', routeOptions, async (request, reply) => {
    const parsed = memorySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_memory_item', issues: parsed.error.issues };
    }
    const item = await repos.createASelfMemoryItem({
      ...parsed.data,
      why: parsed.data.why || null,
      source: 'web_console',
      metadata: { source: 'a_self_console' }
    });
    await repos.audit({ actorType: 'web_console', action: 'a_self_memory_created', entityType: 'a_self_memory_item', entityId: item.id });
    return { ok: true, item };
  });

  app.post<{ Body: unknown }>('/api/web/a-self/decisions', routeOptions, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_decision_log', issues: parsed.error.issues };
    }
    const decision = await repos.createASelfDecisionLog({
      ...parsed.data,
      result: parsed.data.result || null,
      review: parsed.data.review || null,
      futureRule: parsed.data.futureRule || null,
      metadata: { source: 'a_self_console' }
    });
    await repos.audit({ actorType: 'web_console', action: 'a_self_decision_created', entityType: 'a_self_decision_log', entityId: decision.id });
    return { ok: true, decision };
  });

  app.post<{ Body: unknown }>('/api/web/a-self/opc-runs', routeOptions, async (request, reply) => {
    const parsed = opcRunSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, error: 'invalid_opc_run', issues: parsed.error.issues };
    }
    const run = await repos.createASelfOpcRun({
      ...parsed.data,
      marketScan: parsed.data.marketScan || null,
      companyState: parsed.data.companyState || null,
      recommendations: parsed.data.recommendations || null,
      metadata: { source: 'a_self_console' }
    });
    await repos.audit({ actorType: 'web_console', action: 'a_self_opc_run_created', entityType: 'a_self_opc_run', entityId: run.id });
    return { ok: true, run };
  });
}

async function buildASelfDashboard(repos: Repositories) {
  const [profile, memories, decisions, permissions, opcRuns] = await Promise.all([
    repos.getASelfProfile(),
    repos.listASelfMemoryItems(80),
    repos.listASelfDecisionLogs(60),
    repos.listASelfPermissionRules(),
    repos.listASelfOpcRuns(30)
  ]);

  const memoryByCategory = memories.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});
  const decisionRules = decisions.filter((decision) => decision.future_rule).length;
  const autonomyLevels = permissions.reduce<Record<string, number>>((counts, rule) => {
    counts[`level${rule.level}`] = (counts[`level${rule.level}`] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    phase: 'A- 0.1',
    profile,
    metrics: {
      memories: memories.length,
      memoryCategories: Object.keys(memoryByCategory).length,
      decisions: decisions.length,
      decisionRules,
      permissionRules: permissions.length,
      opcRuns: opcRuns.length,
      confidence: Number(profile?.confidence ?? 0)
    },
    memoryByCategory,
    memories,
    decisions,
    permissions,
    autonomyLevels,
    opcRuns,
    roadmap: [
      { phase: '复制记忆', status: memories.length ? 'in_progress' : 'ready', description: '收集人生经历、项目、聊天、邮件、写作和为什么。' },
      { phase: '复制判断', status: decisions.length ? 'in_progress' : 'ready', description: '用 Decision Log 沉淀选择、原因、结果和以后规则。' },
      { phase: '复制行动', status: 'guarded', description: '通过 Level 1/2/3 权限逐步连接 MCP、邮件、飞书、CRM。' },
      { phase: '复制经营能力', status: opcRuns.length ? 'in_progress' : 'planned', description: '早晨市场扫描，晚上经营总结，连接 OPC 公司环境。' }
    ]
  };
}
