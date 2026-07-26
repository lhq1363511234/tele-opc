import type { ApprovalRecord, ArtifactRecord, BusinessAnalyticsFactRecord, LeadRecord, TaskRecord } from '../../types.js';

/**
 * Logical Feishu table names for the operating ledger. Tasks and Leads do not
 * have dedicated tables in the current Base yet, so they are resolved from the
 * environment table map (APPOS_FEISHU_TABLE_MAP_JSON) when configured. Approvals
 * and Artifacts map onto existing Base tables.
 */
export const LEDGER_TABLES = {
  task: 'OperatingTasks',
  approval: 'Approvals',
  lead: 'OperatingLeads',
  artifact: 'Artifacts',
  analytics: 'AnalyticsFacts'
} as const;

export type LedgerObjectKind = keyof typeof LEDGER_TABLES;

const asMillis = (iso: string | null | undefined): number | undefined => {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
};

const clip = (value: string | null | undefined, max = 2000): string => {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const jsonSummary = (value: Record<string, unknown> | null | undefined, max = 2000): string => {
  if (!value || Object.keys(value).length === 0) return '';
  try {
    return clip(JSON.stringify(value), max);
  } catch {
    return '';
  }
};

const publicLink = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/$/, '')}${path}`;

export function taskToFeishuFields(task: TaskRecord, opts: { publicBaseUrl: string }): Record<string, unknown> {
  return {
    id: task.id,
    title: clip(task.title, 500),
    description: clip(task.description, 3000),
    owner_agent: task.owner_agent,
    priority: task.priority,
    risk_level: task.risk_level,
    status: task.status,
    parent_task_id: task.parent_task_id ?? '',
    result: clip(task.result, 3000),
    console_url: publicLink(opts.publicBaseUrl, `/app?route=tasks&focus=${encodeURIComponent(task.id)}`),
    created_at: asMillis(task.created_at),
    updated_at: asMillis(task.updated_at)
  };
}

export function approvalToFeishuFields(
  approval: ApprovalRecord,
  opts: { publicBaseUrl: string }
): Record<string, unknown> {
  return {
    id: approval.id,
    object_type: 'business_contract',
    object_id: approval.task_id ?? '',
    action: approval.action_type,
    risk_level: approval.risk_level,
    status: approval.status === 'pending' ? 'requested' : approval.status,
    reason: clip(approval.prompt, 3000),
    payload_json: jsonSummary(approval.payload),
    console_url: publicLink(opts.publicBaseUrl, `/app?route=approvals&focus=${encodeURIComponent(approval.id)}`),
    requested_at: asMillis(approval.created_at)
  };
}

export function leadToFeishuFields(lead: LeadRecord, opts: { publicBaseUrl: string }): Record<string, unknown> {
  const scoreTotal = (() => {
    const score = lead.score as Record<string, unknown> | null;
    if (!score) return undefined;
    if (typeof score.total === 'number') return score.total;
    if (typeof score.score === 'number') return score.score;
    return undefined;
  })();

  return {
    id: lead.id,
    name: clip(lead.name, 500),
    status: lead.status,
    source: lead.source,
    organization_id: lead.organization_id ?? '',
    contact_id: lead.contact_id ?? '',
    score_json: jsonSummary(lead.score),
    ...(scoreTotal !== undefined ? { score_total: scoreTotal } : {}),
    console_url: publicLink(opts.publicBaseUrl, `/app?route=crm&focus=${encodeURIComponent(lead.id)}`),
    created_at: asMillis(lead.created_at),
    updated_at: asMillis(lead.updated_at)
  };
}

export function artifactToFeishuFields(
  artifact: ArtifactRecord,
  opts: { publicBaseUrl: string }
): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    title: clip(artifact.title, 500),
    source_run_id: artifact.task_id ?? '',
    storage_ref: clip(artifact.uri, 1000),
    preview_url: clip(artifact.uri, 1000),
    status: 'created',
    console_url: publicLink(opts.publicBaseUrl, `/app?route=tasks&focus=${encodeURIComponent(artifact.task_id ?? artifact.id)}`),
    created_at: asMillis(artifact.created_at)
  };
}


/** Maps durable Postgres business facts to the Feishu `经营分析事实` table. */
export function analyticsFactToFeishuFields(fact: BusinessAnalyticsFactRecord): Record<string, unknown> {
  return {
    title: clip(`${fact.metric_name} · ${fact.source_object_type ?? fact.scope}`, 500),
    id: fact.id,
    date: asMillis(fact.occurred_at),
    grain: fact.grain,
    scope: fact.scope,
    metric_code: fact.metric_code,
    metric_name: fact.metric_name,
    metric_value: Number(fact.metric_value ?? 0),
    ...(fact.amount !== null ? { amount: Number(fact.amount) } : {}),
    ...(fact.score !== null ? { score: Number(fact.score) } : {}),
    channel: fact.channel ?? '',
    agent: fact.agent ?? '',
    stage: fact.stage ?? '',
    segment: fact.segment ?? '',
    customer: fact.customer ?? '',
    status: fact.status ?? '',
    note: clip(fact.note, 2000),
    demo_tag: fact.is_demo ? '[演示数据]' : ''
  };
}
