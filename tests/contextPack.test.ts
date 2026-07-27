import { describe, expect, it } from 'vitest';
import { buildContextPack, contextPackForAgentRuntime, summarizeContextPackForBriefing } from '../src/brain/contextPack.js';

describe('context pack', () => {
  it('builds company intelligence from memories, tasks, and risks', async () => {
    const pack = await buildContextPack(
      {
        async listMemories() {
          return [
            {
              id: 'mem_1',
              type: 'preference',
              content: '回复保持简洁，不超过 120 字',
              importance: 'high',
              created_at: '2026-07-01T00:00:00.000Z'
            },
            {
              id: 'mem_2',
              type: 'pricing',
              content: '标准网站维护套餐 3000 CNY / 月',
              importance: 'normal',
              created_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async listTasks() {
          return [
            {
              id: 'tsk_1',
              title: '跟进 Acme 报价',
              status: 'planned',
              risk_level: 'medium',
              owner_agent: 'quote',
              result: null,
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async listTasksByStatuses() {
          return [
            {
              id: 'tsk_2',
              title: 'Campaign 发送失败',
              status: 'failed',
              risk_level: 'high',
              owner_agent: 'email',
              result: 'smtp timeout',
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async listRecentMessagesForChat() {
          return [
            {
              id: 'msg_1',
              direction: 'inbound',
              text: '帮我看看今天公司状态',
              created_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async listPendingApprovals() {
          return [
            {
              id: 'apv_1',
              task_id: 'tsk_2',
              task_title: 'Campaign 发送失败',
              action_type: 'send_email',
              status: 'pending',
              risk_level: 'high',
              prompt: '确认后发送',
              created_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async listAgentRuns() {
          return [
            {
              id: 'agr_1',
              agent_id: 'chief_of_staff',
              status: 'done',
              created_at: '2026-07-01T00:00:00.000Z'
            }
          ];
        },
        async getCrmDashboard() {
          return {
            hotLeads: [{ id: 'ct_1', name: 'Acme' }],
            riskContacts: [],
            overdueFollowUps: []
          };
        },
        async getFinanceDashboard() {
          return {
            riskAlerts: ['有 1 张发票已逾期'],
            netCashflow: -1200,
            currency: 'CNY'
          };
        }
      },
      {
        requestId: 'ctx_test',
        querySummary: '今天公司报价和客户跟进',
        chatId: 'chat_1'
      }
    );

    expect(pack.requestId).toBe('ctx_test');
    expect(pack.ownerPreferences[0]).toContain('简洁');
    expect(pack.pricingRules[0]).toContain('网站维护');
    expect(pack.relevantCustomers[0]?.title).toBe('Acme');
    expect(pack.riskNotes.length).toBeGreaterThan(0);
    expect(pack.recommendedAgents).toContain('quote');

    const runtime = contextPackForAgentRuntime(pack);
    expect(runtime.runtimeState.pendingApprovals[0]?.id).toBe('apv_1');

    const unrelatedRuntime = contextPackForAgentRuntime({
      ...pack,
      querySummary: '写一个读取 CSV 的 Python 脚本'
    });
    expect(unrelatedRuntime.pricingRules).toEqual([]);
    expect(unrelatedRuntime.relevantCustomers).toEqual([]);
    expect(unrelatedRuntime.relevantFinanceItems).toEqual([]);
    expect(unrelatedRuntime.runtimeState.activeTasks).toEqual([]);

    const summary = summarizeContextPackForBriefing(pack);
    expect(summary.join('\n')).toContain('客户焦点');
  });
});
