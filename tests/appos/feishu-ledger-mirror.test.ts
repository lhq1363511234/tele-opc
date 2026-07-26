import { describe, expect, it } from 'vitest';
import { FeishuBaseClient } from '../../src/appos/feishu/base-client.js';
import { NoopLedgerDriver, OpenApiLedgerDriver } from '../../src/appos/feishu/ledger-driver.js';
import { buildFeishuMirror, FeishuMirror } from '../../src/appos/feishu/ledger-mirror.js';
import {
  approvalToFeishuFields,
  artifactToFeishuFields,
  leadToFeishuFields,
  taskToFeishuFields
} from '../../src/appos/feishu/ledger-mappers.js';
import type { ApprovalRecord, ArtifactRecord, LeadRecord, TaskRecord } from '../../src/types.js';

const publicBaseUrl = 'https://tele-opc.opctoai.xyz';

const task: TaskRecord = {
  id: 'task_1',
  title: 'Ship Feishu ledger',
  description: 'mirror operating objects into Feishu',
  origin_message_id: null,
  parent_task_id: null,
  owner_agent: 'chief',
  priority: 'high',
  risk_level: 'low',
  status: 'running',
  sequence: 1,
  planning_metadata: {},
  result: null,
  created_at: '2026-07-20T00:00:00.000Z',
  updated_at: '2026-07-20T01:00:00.000Z'
};

const approval: ApprovalRecord = {
  id: 'appr_1',
  task_id: 'task_1',
  action_type: 'external_publish',
  status: 'pending',
  risk_level: 'medium',
  prompt: 'Publish CPS post to Douyin?',
  payload: { platform: 'douyin' },
  created_at: '2026-07-20T00:30:00.000Z'
};

const lead: LeadRecord = {
  id: 'lead_1',
  prospecting_run_id: null,
  organization_id: 'org_1',
  contact_id: null,
  name: 'Acme Corp',
  status: 'qualified',
  source: 'inbound',
  score: { total: 82 },
  metadata: {},
  created_at: '2026-07-20T00:10:00.000Z',
  updated_at: '2026-07-20T00:20:00.000Z'
};

const artifact: ArtifactRecord = {
  id: 'art_1',
  task_id: 'task_1',
  type: 'document',
  title: 'Proposal deck',
  uri: 'https://files.example/deck.pdf',
  content: null,
  metadata: {},
  created_at: '2026-07-20T00:40:00.000Z'
};

describe('ledger mappers', () => {
  it('maps a task with a console deep link and epoch millis', () => {
    const fields = taskToFeishuFields(task, { publicBaseUrl });
    expect(fields.id).toBe('task_1');
    expect(fields.status).toBe('running');
    expect(fields.console_url).toContain('/app?route=tasks&focus=task_1');
    expect(fields.created_at).toBe(Date.parse(task.created_at));
  });

  it('maps approval prompt to reason and keeps object linkage', () => {
    const fields = approvalToFeishuFields(approval, { publicBaseUrl });
    expect(fields.reason).toBe('Publish CPS post to Douyin?');
    expect(fields.object_id).toBe('task_1');
    expect(fields.status).toBe('requested');
  });

  it('maps lead and artifact ids', () => {
    expect(leadToFeishuFields(lead, { publicBaseUrl }).name).toBe('Acme Corp');
    expect(artifactToFeishuFields(artifact, { publicBaseUrl }).source_run_id).toBe('task_1');
  });
});

describe('noop driver mirror', () => {
  it('records intended writes without network access', async () => {
    const driver = new NoopLedgerDriver();
    const mirror = new FeishuMirror({ publicBaseUrl, driver });
    const res = await mirror.mirrorTask(task);
    expect(res.skipped).toBe(true);
    expect(mirror.mode).toBe('noop');
    expect(driver.writes).toHaveLength(1);
  });
});

describe('buildFeishuMirror', () => {
  it('falls back to noop when credentials are missing', () => {
    const mirror = buildFeishuMirror({ publicBaseUrl });
    expect(mirror.mode).toBe('noop');
  });

  it('uses openapi when credentials are present', () => {
    const mirror = buildFeishuMirror({
      publicBaseUrl,
      appId: 'cli_x',
      appSecret: 'secret',
      appToken: 'OIbnbkS2sa9jBrsQtqzcMj8pnep'
    });
    expect(mirror.mode).toBe('openapi');
  });
});

describe('openapi driver upsert', () => {
  it('creates then updates via injected fetch', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    let existing = false;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/auth/v3/tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 't', expire: 7200 }), { status: 200 });
      }
      if (url.includes('/records/search')) {
        const items = existing ? [{ record_id: 'rec_existing', fields: {} }] : [];
        return new Response(JSON.stringify({ code: 0, data: { items } }), { status: 200 });
      }
      if (method === 'POST' && url.endsWith('/records')) {
        existing = true;
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: 'rec_new', fields: {} } } }), { status: 200 });
      }
      if (method === 'PUT') {
        return new Response(JSON.stringify({ code: 0, data: { record: { record_id: 'rec_existing', fields: {} } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new FeishuBaseClient({
      appId: 'cli_x',
      appSecret: 'secret',
      appToken: 'OIbnbkS2sa9jBrsQtqzcMj8pnep',
      fetch: fetchImpl
    });
    const driver = new OpenApiLedgerDriver(client);

    const first = await driver.upsert('approval', approvalToFeishuFields(approval, { publicBaseUrl }));
    expect(first.created).toBe(true);
    expect(first.recordId).toBe('rec_new');

    const second = await driver.upsert('approval', approvalToFeishuFields(approval, { publicBaseUrl }));
    expect(second.created).toBe(false);
    expect(second.recordId).toBe('rec_existing');
  });
});
