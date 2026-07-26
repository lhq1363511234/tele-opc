import { loadConfig } from '../src/config/index.js';
import { pool } from '../src/db/pool.js';
import { Repositories } from '../src/db/repositories.js';

const config = loadConfig();
const repos = new Repositories(pool);

const numberFromScore = (score: unknown): number => {
  if (typeof score === 'number') return score;
  if (!score || typeof score !== 'object') return 0;
  const rec = score as Record<string, unknown>;
  for (const key of ['total_score', 'total', 'score']) {
    if (typeof rec[key] === 'number') return rec[key] as number;
  }
  return 0;
};

async function main() {
  const [tasks, leads, approvals, runs] = await Promise.all([
    repos.listTasks(500),
    repos.listProspectingLeads(500),
    repos.listPendingApprovals(500),
    repos.listAgentRuns(500)
  ]);
  const artifacts = tasks.length ? await repos.listArtifactsForTaskIds(tasks.map((task) => task.id), 500) : [];
  const campaignEvents = await repos.listCampaignEvents({ limit: 500 });
  let written = 0;

  for (const task of tasks) {
    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_task_${task.id}`,
      occurred_at: task.updated_at ?? task.created_at,
      grain: 'snapshot', scope: 'execution', metric_code: 'task_state_snapshot', metric_name: '任务状态快照', metric_value: 1,
      agent: task.owner_agent, stage: task.priority, status: task.status, note: task.title,
      source_object_type: 'task', source_object_id: task.id, is_demo: false,
      metadata: { bootstrap: true, risk_level: task.risk_level }
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_task_event_${task.id}`,
      occurred_at: task.updated_at ?? task.created_at,
      grain: 'event', scope: 'execution', metric_code: 'task_event', metric_name: '任务事件', metric_value: 1,
      agent: task.owner_agent, stage: task.priority, status: task.status, note: task.title,
      source_object_type: 'task', source_object_id: task.id, is_demo: false,
      metadata: { bootstrap: true }
    });
    written += 1;

    if (task.status === 'done') {
      await repos.recordBusinessAnalyticsFact({
        id: `baf_boot_task_done_${task.id}`,
        occurred_at: task.updated_at ?? task.created_at,
        grain: 'event', scope: 'execution', metric_code: 'tasks_done', metric_name: '任务完成', metric_value: 1,
        agent: task.owner_agent, stage: task.priority, status: 'done', note: task.title,
        source_object_type: 'task', source_object_id: task.id, is_demo: false,
        metadata: { bootstrap: true }
      });
      written += 1;
    }
  }

  for (const lead of leads) {
    const score = numberFromScore(lead.score);
    const base = {
      occurred_at: lead.created_at,
      grain: 'event' as const,
      scope: 'sales',
      score,
      channel: lead.source,
      customer: lead.name,
      stage: lead.status,
      status: lead.status,
      note: lead.name,
      source_object_type: 'lead',
      source_object_id: lead.id,
      is_demo: false,
      metadata: { bootstrap: true, organization_id: lead.organization_id, contact_id: lead.contact_id }
    };

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_lead_${lead.id}`,
      ...base,
      metric_code: 'lead_quality_event',
      metric_name: '线索质量事件',
      metric_value: 1
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_lead_created_${lead.id}`,
      ...base,
      metric_code: 'lead_created',
      metric_name: '新增线索',
      metric_value: 1
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_new_leads_${lead.id}`,
      ...base,
      metric_code: 'new_leads',
      metric_name: '新增线索计数',
      metric_value: 1
    });
    written += 1;

    if (lead.source) {
      await repos.recordBusinessAnalyticsFact({
        id: `baf_boot_leads_by_channel_${lead.id}`,
        ...base,
        scope: 'growth',
        metric_code: 'leads_by_channel',
        metric_name: '渠道线索',
        metric_value: 1
      });
      written += 1;
    }
  }

  for (const approval of approvals) {
    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_approval_${approval.id}`,
      occurred_at: approval.created_at,
      grain: 'event', scope: 'risk', metric_code: 'approval_requested', metric_name: '审批请求', metric_value: 1,
      stage: approval.risk_level, status: approval.status, note: approval.prompt,
      source_object_type: 'approval', source_object_id: approval.id, is_demo: false,
      metadata: { bootstrap: true, action_type: approval.action_type, task_id: approval.task_id }
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_approvals_by_risk_${approval.id}`,
      occurred_at: approval.created_at,
      grain: 'event', scope: 'risk', metric_code: 'approvals_by_risk', metric_name: '审批风险分布', metric_value: 1,
      stage: approval.risk_level, status: approval.status, note: approval.prompt,
      source_object_type: 'approval', source_object_id: approval.id, is_demo: false,
      metadata: { bootstrap: true }
    });
    written += 1;
  }

  for (const run of runs) {
    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_run_${run.id}`,
      occurred_at: run.started_at,
      grain: 'event', scope: 'execution', metric_code: 'agent_load', metric_name: 'Agent 运行', metric_value: 1,
      agent: run.agent_id, status: run.status, note: `${run.agent_id} · ${run.model}`,
      source_object_type: 'agent_run', source_object_id: run.id, is_demo: false,
      metadata: { bootstrap: true, provider: run.provider, model: run.model }
    });
    written += 1;
  }

  for (const artifact of artifacts) {
    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_artifact_${artifact.id}`,
      occurred_at: artifact.created_at,
      grain: 'event', scope: 'delivery', metric_code: 'artifact_created', metric_name: '交付物创建', metric_value: 1,
      stage: artifact.type, status: 'created', note: artifact.title,
      source_object_type: 'artifact', source_object_id: artifact.id, is_demo: false,
      metadata: { bootstrap: true, task_id: artifact.task_id, uri: artifact.uri }
    });
    written += 1;

    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_delivery_quality_${artifact.id}`,
      occurred_at: artifact.created_at,
      grain: 'event', scope: 'delivery', metric_code: 'delivery_quality', metric_name: '交付质量', metric_value: 1,
      score: 80, stage: artifact.type, status: 'created', note: artifact.title,
      source_object_type: 'artifact', source_object_id: artifact.id, is_demo: false,
      metadata: { bootstrap: true, score_basis: 'artifact_created_default' }
    });
    written += 1;
  }

  for (const event of campaignEvents) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const recipient = typeof payload.recipient === 'string'
      ? payload.recipient
      : typeof payload.leadName === 'string'
        ? payload.leadName
        : null;
    const channel = typeof payload.channel === 'string' ? payload.channel : 'email';
    const isEmailSent = event.event_type === 'email_sent';
    await repos.recordBusinessAnalyticsFact({
      id: `baf_boot_campaign_event_${event.id}`,
      occurred_at: event.created_at,
      grain: 'event',
      scope: isEmailSent ? 'content' : 'sales',
      metric_code: isEmailSent ? 'campaign_email_sent' : 'campaign_event',
      metric_name: isEmailSent ? '邮件触达' : '活动事件',
      metric_value: 1,
      channel,
      customer: recipient,
      stage: event.event_type,
      status: event.event_type,
      note: typeof payload.subject === 'string' ? payload.subject : event.event_type,
      source_object_type: 'campaign_event',
      source_object_id: event.id,
      is_demo: false,
      metadata: { bootstrap: true, campaign_id: event.campaign_id, lead_id: event.lead_id }
    });
    written += 1;

    if (isEmailSent) {
      await repos.recordBusinessAnalyticsFact({
        id: `baf_boot_content_output_${event.id}`,
        occurred_at: event.created_at,
        grain: 'event',
        scope: 'content',
        metric_code: 'content_output',
        metric_name: '内容产出',
        metric_value: 1,
        channel,
        customer: recipient,
        stage: 'email',
        status: 'sent',
        note: typeof payload.subject === 'string' ? payload.subject : 'campaign email',
        source_object_type: 'campaign_event',
        source_object_id: event.id,
        is_demo: false,
        metadata: { bootstrap: true, campaign_id: event.campaign_id, lead_id: event.lead_id }
      });
      written += 1;

      await repos.recordBusinessAnalyticsFact({
        id: `baf_boot_content_by_platform_${event.id}`,
        occurred_at: event.created_at,
        grain: 'event',
        scope: 'content',
        metric_code: 'content_by_platform',
        metric_name: '平台内容产出',
        metric_value: 1,
        channel,
        customer: recipient,
        stage: 'email',
        status: 'sent',
        note: typeof payload.subject === 'string' ? payload.subject : 'campaign email',
        source_object_type: 'campaign_event',
        source_object_id: event.id,
        is_demo: false,
        metadata: { bootstrap: true }
      });
      written += 1;
    }
  }

  const facts = await repos.listBusinessAnalyticsFacts(5000);
  console.log(JSON.stringify({
    ok: true,
    written,
    currentFacts: facts.length,
    source: 'postgres_business_analytics_facts',
    app: config.app.name,
    inputs: {
      tasks: tasks.length,
      leads: leads.length,
      approvals: approvals.length,
      runs: runs.length,
      artifacts: artifacts.length,
      campaignEvents: campaignEvents.length
    }
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
