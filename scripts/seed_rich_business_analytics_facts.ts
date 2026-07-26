import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/index.js';
import { pool } from '../src/db/pool.js';
import { Repositories } from '../src/db/repositories.js';

/**
 * Seed a dense 45-day operating fact lattice so Feishu dashboards and the
 * website BI surface are immediately useful. These rows are intentionally
 * rich sample data (not production finance). Clear them later with:
 *   DELETE FROM business_analytics_facts WHERE metadata->>'seed' = 'rich_v1';
 * or full table wipe when you reset the environment.
 */

const config = loadConfig();
const repos = new Repositories(pool);

const channels = ['官网表单', '飞书私域', 'Telegram获客', '邮件外呼', '短剧CPS', '代理渠道', '内容种草', '老客转介'];
const agents = ['chief_of_staff', 'sales', 'research', 'content', 'email', 'browser', 'finance', 'ops'];
const customers = [
  '北极星制造', '云启零售', '澜海物流', '星河教育', '青松医疗', '远航跨境', '墨白科技', '锦程房产',
  '跃迁汽车', '南风餐饮', '光年传媒', '海图芯片', '同舟能源', '飞羽出行', '梧桐SaaS', '青橙消费'
];
const segments = ['制造业', '零售电商', '物流供应链', '教育培训', '医疗健康', '跨境贸易', '汽车出行', '本地生活'];
const leadStages = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const taskStatuses = ['new', 'running', 'blocked', 'done', 'failed'];
const platforms = ['小红书', '抖音', '视频号', 'B站', '邮件', 'Telegram', '飞书'];

function dayOffset(daysAgo: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const rand = mulberry32(20260721);
  let written = 0;

  // Wipe previous rich seed only (keep real projected facts).
  const wiped = await pool.query(
    `DELETE FROM business_analytics_facts WHERE metadata->>'seed' = 'rich_v1'`
  );

  for (let day = 44; day >= 0; day -= 1) {
    const occurredAt = dayOffset(day);
    const wave = 1 + Math.sin((44 - day) / 7) * 0.35 + (rand() - 0.5) * 0.2;
    const leadsToday = Math.max(1, Math.round((4 + (44 - day) * 0.08) * wave));
    const contentToday = Math.max(1, Math.round((3 + (44 - day) * 0.05) * wave));
    const tasksDoneToday = Math.max(1, Math.round((2 + (44 - day) * 0.04) * wave));
    const quotesToday = Math.max(0, Math.round(leadsToday * 0.35));
    const winsToday = Math.max(0, Math.round(quotesToday * 0.28));
    const pipelineUnit = 18000 + Math.round(rand() * 42000);
    const revenueUnit = 22000 + Math.round(rand() * 68000);

    // Daily lead intake + channel distribution
    for (let i = 0; i < leadsToday; i += 1) {
      const channel = pick(channels, day + i * 3);
      const customer = pick(customers, day * 2 + i);
      const stage = pick(leadStages, day + i);
      const segment = pick(segments, day + i * 2);
      const score = Math.round(45 + rand() * 50);
      const sourceId = `seed_lead_${day}_${i}`;
      const baseMeta = { seed: 'rich_v1', day, kind: 'lead' };

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_new_leads_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'new_leads',
        metric_name: '新增线索计数',
        metric_value: 1,
        score,
        channel,
        customer,
        stage,
        segment,
        status: stage,
        note: `${customer} · ${channel}`,
        source_object_type: 'seed_lead',
        source_object_id: sourceId,
        is_demo: false,
        metadata: baseMeta
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_lead_quality_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'lead_quality_event',
        metric_name: '线索质量事件',
        metric_value: 1,
        score,
        channel,
        customer,
        stage,
        segment,
        status: stage,
        note: `${customer} 质量评分 ${score}`,
        source_object_type: 'seed_lead',
        source_object_id: sourceId,
        is_demo: false,
        metadata: baseMeta
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_leads_by_channel_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'growth',
        metric_code: 'leads_by_channel',
        metric_name: '渠道线索',
        metric_value: 1,
        channel,
        customer,
        stage,
        segment,
        status: stage,
        note: channel,
        source_object_type: 'seed_lead',
        source_object_id: sourceId,
        is_demo: false,
        metadata: baseMeta
      });
      written += 1;

      if (stage === 'qualified' || stage === 'proposal' || stage === 'won') {
        await repos.recordBusinessAnalyticsFact({
          id: `baf_seed_qualified_${day}_${i}`,
          occurred_at: occurredAt,
          grain: 'event',
          scope: 'sales',
          metric_code: 'qualified_leads',
          metric_name: '合格线索',
          metric_value: 1,
          score,
          channel,
          customer,
          stage,
          segment,
          status: stage,
          note: customer,
          source_object_type: 'seed_lead',
          source_object_id: sourceId,
          is_demo: false,
          metadata: baseMeta
        });
        written += 1;
      }
    }

    // Quotes / pipeline / wins / revenue
    for (let i = 0; i < quotesToday; i += 1) {
      const customer = pick(customers, day + i + 5);
      const segment = pick(segments, day + i);
      const amount = pipelineUnit + i * 1500;
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_quote_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'quotes_created',
        metric_name: '报价产出',
        metric_value: 1,
        amount,
        channel: pick(channels, day + i),
        customer,
        stage: 'proposal',
        segment,
        status: 'quoted',
        note: `${customer} 报价`,
        source_object_type: 'seed_quote',
        source_object_id: `seed_quote_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_pipeline_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'pipeline_amount',
        metric_name: '管道金额',
        metric_value: amount,
        amount,
        channel: pick(channels, day + i),
        customer,
        stage: 'proposal',
        segment,
        status: 'open',
        note: `${customer} 管道`,
        source_object_type: 'seed_opportunity',
        source_object_id: `seed_opp_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_pipeline_seg_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'pipeline_by_segment',
        metric_name: '行业管道',
        metric_value: amount,
        amount,
        customer,
        stage: 'proposal',
        segment,
        status: 'open',
        note: segment,
        source_object_type: 'seed_opportunity',
        source_object_id: `seed_opp_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    for (let i = 0; i < winsToday; i += 1) {
      const customer = pick(customers, day + i + 9);
      const amount = revenueUnit + i * 3200;
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_won_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'sales',
        metric_code: 'deals_won',
        metric_name: '成交商机',
        metric_value: 1,
        amount,
        channel: pick(channels, day + i + 1),
        customer,
        stage: 'won',
        segment: pick(segments, day + i + 3),
        status: 'won',
        note: `${customer} 成交`,
        source_object_type: 'seed_deal',
        source_object_id: `seed_deal_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_revenue_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'finance',
        metric_code: 'revenue_amount',
        metric_name: '成交金额',
        metric_value: amount,
        amount,
        channel: pick(channels, day + i + 1),
        customer,
        stage: 'paid',
        segment: pick(segments, day + i + 3),
        status: 'paid',
        note: `${customer} 回款`,
        source_object_type: 'seed_invoice',
        source_object_id: `seed_inv_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    // Funnel snapshot once per day
    const funnel = [
      ['访客', Math.round(leadsToday * 8.5)],
      ['线索', leadsToday],
      ['合格', Math.max(1, Math.round(leadsToday * 0.55))],
      ['报价', Math.max(0, quotesToday)],
      ['成交', Math.max(0, winsToday)]
    ] as const;
    for (const [stage, value] of funnel) {
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_funnel_${day}_${stage}`,
        occurred_at: occurredAt,
        grain: 'daily',
        scope: 'growth',
        metric_code: 'funnel_snapshot',
        metric_name: '漏斗快照',
        metric_value: value,
        stage,
        status: 'snapshot',
        note: `${occurredAt.slice(0, 10)} ${stage}`,
        source_object_type: 'seed_funnel',
        source_object_id: `seed_funnel_${day}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    // Content production by platform
    for (let i = 0; i < contentToday; i += 1) {
      const platform = pick(platforms, day + i);
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_content_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'content',
        metric_code: 'content_output',
        metric_name: '内容产出',
        metric_value: 1,
        channel: platform,
        agent: pick(agents, day + i),
        stage: 'published',
        status: 'published',
        note: `${platform} 内容`,
        source_object_type: 'seed_content',
        source_object_id: `seed_content_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_content_platform_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'content',
        metric_code: 'content_by_platform',
        metric_name: '平台内容产出',
        metric_value: 1,
        channel: platform,
        stage: 'published',
        status: 'published',
        note: platform,
        source_object_type: 'seed_content',
        source_object_id: `seed_content_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    // Execution / risk / delivery
    for (let i = 0; i < tasksDoneToday; i += 1) {
      const status = i === 0 && day % 5 === 0 ? 'blocked' : pick(taskStatuses, day + i);
      const agent = pick(agents, day + i + 2);
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_task_event_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'execution',
        metric_code: 'task_event',
        metric_name: '任务事件',
        metric_value: 1,
        agent,
        stage: 'normal',
        status,
        note: `${agent} 任务`,
        source_object_type: 'seed_task',
        source_object_id: `seed_task_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;

      if (status === 'done') {
        await repos.recordBusinessAnalyticsFact({
          id: `baf_seed_tasks_done_${day}_${i}`,
          occurred_at: occurredAt,
          grain: 'event',
          scope: 'execution',
          metric_code: 'tasks_done',
          metric_name: '任务完成',
          metric_value: 1,
          agent,
          status: 'done',
          note: `${agent} 完成`,
          source_object_type: 'seed_task',
          source_object_id: `seed_task_${day}_${i}`,
          is_demo: false,
          metadata: { seed: 'rich_v1', day }
        });
        written += 1;
      }

      if (status === 'blocked') {
        await repos.recordBusinessAnalyticsFact({
          id: `baf_seed_tasks_blocked_${day}_${i}`,
          occurred_at: occurredAt,
          grain: 'event',
          scope: 'execution',
          metric_code: 'tasks_blocked',
          metric_name: '任务阻塞',
          metric_value: 1,
          agent,
          status: 'blocked',
          note: `${agent} 阻塞`,
          source_object_type: 'seed_task',
          source_object_id: `seed_task_${day}_${i}`,
          is_demo: false,
          metadata: { seed: 'rich_v1', day }
        });
        written += 1;
      }

      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_agent_load_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'execution',
        metric_code: 'agent_load',
        metric_name: 'Agent 运行',
        metric_value: 1,
        agent,
        status: status === 'failed' ? 'failed' : 'completed',
        note: agent,
        source_object_type: 'seed_agent_run',
        source_object_id: `seed_run_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    // Approvals / risk / failures / delivery quality / SLA health
    const riskLevels = ['low', 'medium', 'high', 'critical'] as const;
    for (let i = 0; i < 2; i += 1) {
      const risk = pick([...riskLevels], day + i);
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_approval_${day}_${i}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'risk',
        metric_code: 'approvals_by_risk',
        metric_name: '审批风险分布',
        metric_value: 1,
        stage: risk,
        status: day % 3 === 0 ? 'pending' : 'approved',
        note: `${risk} 风险审批`,
        source_object_type: 'seed_approval',
        source_object_id: `seed_apv_${day}_${i}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    if (day % 4 === 0) {
      await repos.recordBusinessAnalyticsFact({
        id: `baf_seed_failure_${day}`,
        occurred_at: occurredAt,
        grain: 'event',
        scope: 'risk',
        metric_code: 'failure_event',
        metric_name: '故障事件',
        metric_value: 1,
        stage: pick(['timeout', 'provider_error', 'validation', 'rate_limit'], day),
        status: 'open',
        agent: pick(agents, day),
        note: '执行故障',
        source_object_type: 'seed_failure',
        source_object_id: `seed_fail_${day}`,
        is_demo: false,
        metadata: { seed: 'rich_v1', day }
      });
      written += 1;
    }

    await repos.recordBusinessAnalyticsFact({
      id: `baf_seed_delivery_${day}`,
      occurred_at: occurredAt,
      grain: 'daily',
      scope: 'delivery',
      metric_code: 'delivery_quality',
      metric_name: '交付质量',
      metric_value: 1,
      score: Math.round(72 + rand() * 25),
      stage: 'accepted',
      status: 'accepted',
      note: '日交付质量',
      source_object_type: 'seed_delivery',
      source_object_id: `seed_delivery_${day}`,
      is_demo: false,
      metadata: { seed: 'rich_v1', day }
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_seed_sla_${day}`,
      occurred_at: occurredAt,
      grain: 'daily',
      scope: 'execution',
      metric_code: 'sla_health',
      metric_name: '执行健康分',
      metric_value: Math.round(70 + rand() * 28),
      score: Math.round(70 + rand() * 28),
      stage: 'daily',
      status: 'ok',
      note: 'SLA 健康度',
      source_object_type: 'seed_sla',
      source_object_id: `seed_sla_${day}`,
      is_demo: false,
      metadata: { seed: 'rich_v1', day }
    });
    written += 1;
  }

  const facts = await repos.listBusinessAnalyticsFacts(5000);
  const seedCount = await pool.query(
    `SELECT count(*)::int AS n FROM business_analytics_facts WHERE metadata->>'seed' = 'rich_v1'`
  );
  console.log(JSON.stringify({
    ok: true,
    wiped: wiped.rowCount ?? 0,
    written,
    seedFacts: seedCount.rows[0]?.n ?? 0,
    totalFacts: facts.length,
    app: config.app.name,
    note: 'Seed rows are marked metadata.seed=rich_v1 and can be deleted later.'
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
