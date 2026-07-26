import { FeishuBaseClient, type FeishuRecord } from '../appos/feishu/base-client.js';
import type { AppConfig } from '../config/index.js';

type SeriesPoint = { date: string; value: number };
type Breakdown = { label: string; value: number };
type AnalyticsMode = 'feishu_live' | 'empty';

export type BusinessAnalytics = {
  ok: true;
  source: { mode: AnalyticsMode; label: string; refreshedAt: string; facts: number; message: string };
  company: { kpis: Array<{ key: string; label: string; value: number; format: 'number' | 'money' | 'percent'; hint: string }>; trends: Record<string, SeriesPoint[]>; breakdowns: Record<string, Breakdown[]> };
  growth: { funnel: Breakdown[]; channels: Breakdown[]; leadStates: Breakdown[]; platform: Breakdown[]; leadQuality: Breakdown[] };
  customers: { kpis: Array<{ key: string; label: string; value: number; format: 'number' | 'money' | 'percent'; hint: string }>; ranking: Array<{ name: string; score: number; amount: number; stage: string; segment: string; source: string }>; segments: Breakdown[]; stages: Breakdown[] };
  execution: { taskStatus: Breakdown[]; agentLoad: Breakdown[]; risk: Breakdown[]; delivery: Breakdown[]; failures: Breakdown[] };
  weekly: { kpis: Array<{ key: string; label: string; value: number; format: 'number' | 'money' | 'percent'; hint: string }>; trends: Record<string, SeriesPoint[]> };
};

type Fact = Record<string, unknown>;
const num = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0) || 0;
const text = (value: unknown) => Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
const dateKey = (value: unknown) => {
  const raw = text(value);
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch > 1_000_000_000) {
    return new Date(epoch < 10_000_000_000 ? epoch * 1000 : epoch).toISOString().slice(0, 10);
  }
  return raw.slice(0, 10);
};
const sum = (rows: Fact[], selector: (row: Fact) => number) => rows.reduce((total, row) => total + selector(row), 0);
const select = (rows: Fact[], ...codes: string[]) => rows.filter((row) => codes.includes(text(row.metric_code)));

function uniqueBySource(rows: Fact[]): Fact[] {
  const map = new Map<string, Fact>();
  for (const row of rows) {
    const sourceId = text(row.source_object_id);
    const customer = text(row.customer);
    const channel = text(row.channel);
    const stage = text(row.stage);
    const date = dateKey(row.date);
    const key = sourceId
      || (customer ? `${text(row.metric_code)}:${customer}:${channel}:${stage}:${date}` : '')
      || text(row.id)
      || `${text(row.metric_code)}:${date}:${text(row.note)}`;
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function group(rows: Fact[], key: (row: Fact) => string, value: (row: Fact) => number = () => 1): Breakdown[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = key(row) || '未标注';
    map.set(label, (map.get(label) ?? 0) + value(row));
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function series(rows: Fact[], value: (row: Fact) => number): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const date = dateKey(row.date);
    if (!date) continue;
    map.set(date, (map.get(date) ?? 0) + value(row));
  }
  return [...map.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function average(rows: Fact[], value: (row: Fact) => number) {
  return rows.length ? sum(rows, value) / rows.length : 0;
}

async function readFacts(config: AppConfig): Promise<Fact[]> {
  if (!config.feishu.appId || !config.feishu.appSecret || !config.feishu.baseAppToken) return [];
  const client = new FeishuBaseClient({ appId: config.feishu.appId, appSecret: config.feishu.appSecret, appToken: config.feishu.baseAppToken, baseUrl: config.feishu.openBaseUrl });
  const records: FeishuRecord[] = [];
  let token: string | undefined;
  for (let page = 0; page < 40; page += 1) {
    const result = await client.listRecords('AnalyticsFacts', { pageSize: 200, pageToken: token });
    records.push(...result.items);
    if (!result.hasMore || !result.pageToken) break;
    token = result.pageToken;
  }
  // Website BI uses only real facts from Feishu. Demo rows remain in Base for
  // dashboard layout preview, but are never mixed into operational decisions.
  return records
    .map((record) => record.fields)
    .filter((fields) => !text(fields.demo_tag).includes('演示'));
}

export async function buildBusinessAnalytics(config: AppConfig): Promise<BusinessAnalytics> {
  let facts: Fact[] = [];
  let mode: AnalyticsMode = 'empty';
  try {
    facts = await readFacts(config);
    mode = facts.length ? 'feishu_live' : 'empty';
  } catch {
    facts = [];
  }
  if (!facts.length) mode = 'empty';

  // Prefer a single canonical metric code per KPI family so companion projections
  // (lead_created + new_leads + lead_quality_event) do not inflate website numbers.
  // Fall back only when the preferred code is absent.
  const prefer = (...codes: string[]) => {
    for (const code of codes) {
      const rows = select(facts, code);
      if (rows.length) return uniqueBySource(rows);
    }
    return [] as Fact[];
  };
  const leadRows = prefer('new_leads', 'lead_created', 'lead_quality_event');
  const channelRows = prefer('leads_by_channel', 'lead_created', 'new_leads');
  const contentRows = prefer('content_output', 'campaign_email_sent');
  const platformRows = prefer('content_by_platform', 'content_output', 'campaign_email_sent');
  const taskRows = prefer('task_event', 'task_state_snapshot', 'tasks_done', 'task_status_changed', 'task_created');
  const tasksDoneRows = prefer('tasks_done');
  const agentRows = prefer('agent_load');
  const approvalRows = prefer('approvals_by_risk', 'approval_requested');
  const deliveryRows = prefer('delivery_quality', 'artifact_created');
  const failureRows = prefer('failure_event');
  const revenueRows = select(facts, 'revenue_amount');
  const pipelineRows = select(facts, 'pipeline_amount');
  const quoteRows = select(facts, 'quotes_created');
  const winRows = select(facts, 'deals_won');
  const healthRows = select(facts, 'sla_health');
  const qualifiedRows = select(facts, 'qualified_leads');
  const blockedRows = select(facts, 'tasks_blocked');
  const funnelRows = select(facts, 'funnel_snapshot');
  const industryRows = select(facts, 'pipeline_by_segment');

  const message = mode === 'feishu_live' ? '数据来自飞书经营分析事实表。' : '暂无可用于分析的数据。';
  const kpi = (key: string, label: string, value: number, format: 'number' | 'money' | 'percent', hint: string) => ({ key, label, value, format, hint });

  const customerMap = new Map<string, { name: string; scoreTotal: number; scoreN: number; amount: number; stages: Map<string, number>; segments: Map<string, number>; sources: Map<string, number> }>();
  for (const row of leadRows) {
    const name = text(row.customer) || '未命名客户';
    const entry = customerMap.get(name) ?? { name, scoreTotal: 0, scoreN: 0, amount: 0, stages: new Map(), segments: new Map(), sources: new Map() };
    entry.scoreTotal += num(row.score || row.metric_value);
    entry.scoreN += 1;
    entry.amount += num(row.amount);
    const stage = text(row.stage);
    entry.stages.set(stage, (entry.stages.get(stage) ?? 0) + 1);
    const segment = text(row.segment);
    entry.segments.set(segment, (entry.segments.get(segment) ?? 0) + 1);
    const source = text(row.channel);
    entry.sources.set(source, (entry.sources.get(source) ?? 0) + 1);
    customerMap.set(name, entry);
  }
  const customers = [...customerMap.values()]
    .map((entry) => ({
      name: entry.name,
      score: entry.scoreN ? entry.scoreTotal / entry.scoreN : 0,
      amount: entry.amount,
      stage: [...entry.stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'new',
      segment: [...entry.segments.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '未标注',
      source: [...entry.sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '未标注'
    }))
    .sort((a, b) => b.amount - a.amount || b.score - a.score);

  const totalRevenue = sum(revenueRows, (row) => num(row.amount || row.metric_value));
  const totalPipeline = sum(pipelineRows, (row) => num(row.amount || row.metric_value));
  const totalLeads = leadRows.length;
  const totalQuotes = sum(quoteRows, (row) => num(row.metric_value));
  const totalWins = sum(winRows, (row) => num(row.metric_value));
  const totalContent = contentRows.length;
  const customerPipeline = sum(leadRows, (row) => num(row.amount));
  const avgQuality = average(leadRows, (row) => num(row.score || row.metric_value));
  const weeklyKpis = [
    kpi('leads', '45日新增线索', totalLeads, 'number', '增长进水'),
    kpi('quotes', '45日报价产出', totalQuotes, 'number', '进入报价'),
    kpi('revenue', '45日成交金额', totalRevenue, 'money', '已赢商机'),
    kpi('pipeline', '45日管道金额', totalPipeline, 'money', '尚可转化')
  ];

  return {
    ok: true,
    source: {
      mode,
      label: mode === 'feishu_live' ? '飞书经营事实' : '暂无数据',
      refreshedAt: new Date().toISOString(),
      facts: facts.length,
      message
    },
    company: {
      kpis: [
        kpi('leads', '累计新增线索', totalLeads, 'number', '45 日增长进水'),
        kpi('revenue', '累计成交金额', totalRevenue, 'money', '已赢商机'),
        kpi('pipeline', '累计管道金额', totalPipeline, 'money', '进行中机会'),
        kpi('content', '累计内容产出', totalContent, 'number', '内容/邮件触达'),
        kpi('health', '平均执行健康分', average(healthRows, (r) => num(r.metric_value)), 'percent', '执行稳定性')
      ],
      trends: {
        leads: series(leadRows, () => 1),
        revenue: series(revenueRows, (r) => num(r.amount || r.metric_value)),
        pipeline: series(pipelineRows, (r) => num(r.amount || r.metric_value)),
        content: series(contentRows, () => 1),
        health: series(healthRows, (r) => num(r.metric_value))
      },
      breakdowns: {
        industryPipeline: group(industryRows, (r) => text(r.segment), (r) => num(r.amount || r.metric_value)),
        scope: group(facts, (r) => text(r.scope))
      }
    },
    growth: {
      funnel: group(funnelRows, (r) => text(r.stage), (r) => num(r.metric_value)),
      channels: group(channelRows, (r) => text(r.channel), () => 1),
      leadStates: group(leadRows, (r) => text(r.stage)),
      platform: group(platformRows, (r) => text(r.channel), () => 1),
      leadQuality: group(leadRows, (r) => text(r.segment || r.stage), (r) => num(r.score || r.metric_value))
    },
    customers: {
      kpis: [
        kpi('events', '客户事件数', leadRows.length, 'number', '可分析客户事件'),
        kpi('quality', '平均客户质量分', avgQuality, 'percent', '评分均值'),
        kpi('pipeline', '预估客户管道', customerPipeline, 'money', '客户级潜在金额'),
        kpi('delivery', '交付质量均分', average(deliveryRows, (r) => num(r.score || r.metric_value)), 'percent', '交付维度')
      ],
      ranking: customers.slice(0, 12),
      segments: group(leadRows, (r) => text(r.segment || r.stage), () => 1),
      stages: group(leadRows, (r) => text(r.stage))
    },
    execution: {
      taskStatus: group(taskRows, (r) => text(r.status)),
      agentLoad: group(agentRows, (r) => text(r.agent), () => 1),
      risk: group(approvalRows, (r) => text(r.stage), () => 1),
      delivery: group(deliveryRows, (r) => text(r.status || r.stage)),
      failures: group(failureRows, (r) => text(r.stage))
    },
    weekly: {
      kpis: weeklyKpis,
      trends: {
        leads: series(leadRows, () => 1),
        qualified: series(qualifiedRows, (r) => num(r.metric_value)),
        quotes: series(quoteRows, (r) => num(r.metric_value)),
        won: series(winRows, (r) => num(r.metric_value)),
        revenue: series(revenueRows, (r) => num(r.amount || r.metric_value)),
        pipeline: series(pipelineRows, (r) => num(r.amount || r.metric_value)),
        tasks: series(tasksDoneRows.length ? tasksDoneRows : taskRows, () => 1),
        blocked: series(blockedRows, (r) => num(r.metric_value))
      }
    }
  };
}
