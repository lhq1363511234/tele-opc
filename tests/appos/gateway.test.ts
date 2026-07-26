import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAppOSGateway } from '../../src/appos/gateway/routes.js';
import { AppOSGatewayService } from '../../src/appos/gateway/service.js';

const buildApp = () => {
  const app = Fastify();
  const service = new AppOSGatewayService();
  registerAppOSGateway(app, service);
  return { app, service };
};

const contractPayload = {
  id: 'bc_gateway_001',
  sourceIntentPacketId: 'intent_gateway_001',
  sourceUtteranceId: 'utt_gateway_001',
  goal: 'Create a CPS content matrix',
  domain: 'social_distribution',
  successCriteria: ['create posts'],
  inputs: { topic: 'AI tools CPS' },
  expectedOutputs: ['workflow_run', 'artifact', 'approval'],
  riskLevel: 'medium',
  approvalRequired: true,
  constraints: ['Mora frozen'],
  memoryPolicy: 'candidate_only',
  createdAt: '2026-06-24T01:30:00.000Z'
};

describe('AppOS Gateway routes', () => {
  it('creates a business contract and application event', async () => {
    const { app, service } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/contracts',
      payload: contractPayload
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.contract.id).toBe('bc_gateway_001');
    expect(body.event.eventType).toBe('business_contract_created');
    expect((await service.getContract('bc_gateway_001'))?.goal).toBe('Create a CPS content matrix');
  });

  it('rejects invalid contracts with missing fields', async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/contracts',
      payload: { ...contractPayload, goal: '' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
    expect(response.json().error).toContain('goal');
  });

  it('stores application events append-only', async () => {
    const { app, service } = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/events',
      payload: {
        id: 'evt_001',
        source: 'tele-opc',
        eventType: 'workflow_started',
        localObjectType: 'workflow_run',
        localObjectId: 'run_001',
        summary: 'Workflow started',
        evidenceRefs: [],
        externalRefs: [],
        memoryCandidates: [],
        timestamp: '2026-06-24T01:30:00.000Z'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(await service.listEvents()).toHaveLength(1);
  });

  it('returns workflow run status by id', async () => {
    const { app, service } = buildApp();
    await service.createPlannedRun({
      workflowDefinitionId: 'wf_content_matrix',
      provider: 'n8n',
      businessContractId: 'bc_gateway_001',
      input: { topic: 'AI tools CPS' }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/appos/runs/run_0001'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run.status).toBe('planned');
  });

  it('updates workflow run status from n8n callback', async () => {
    const { app, service } = buildApp();
    await service.createPlannedRun({
      workflowDefinitionId: 'wf_content_matrix',
      provider: 'n8n',
      businessContractId: 'bc_gateway_001',
      input: { topic: 'AI tools CPS' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/webhooks/n8n/run-callback',
      payload: {
        runId: 'run_0001',
        status: 'done',
        output: { artifactId: 'art_001' },
        externalExecutionId: 'exec_001'
      }
    });

    expect(response.statusCode).toBe(200);
    expect((await service.getRun('run_0001'))?.status).toBe('done');
  });

  it('normalizes failed n8n callbacks into failure events', async () => {
    const { app, service } = buildApp();
    await service.createPlannedRun({
      workflowDefinitionId: 'wf_content_matrix',
      provider: 'n8n',
      businessContractId: 'bc_gateway_001',
      input: { topic: 'AI tools CPS' }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/appos/webhooks/n8n/run-callback',
      payload: {
        runId: 'run_0001',
        status: 'failed',
        error: { message: 'Dify output malformed' },
        externalExecutionId: 'exec_001'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().failure.symptom).toContain('Dify output malformed');
  });
});
