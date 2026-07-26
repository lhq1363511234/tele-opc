import { describe, expect, it } from 'vitest';
import { AppOSGatewayService, InMemoryAppOSStore } from '../../src/appos/gateway/service.js';

describe('AppOS store abstraction', () => {
  it('persists contracts and runs through the store interface', async () => {
    const store = new InMemoryAppOSStore();
    const service = new AppOSGatewayService(store);

    const created = await service.createContract({
      id: 'bc_store_001',
      sourceIntentPacketId: 'intent_1',
      sourceUtteranceId: 'utt_1',
      goal: 'Persist workflow contracts',
      domain: 'ops',
      successCriteria: ['store contract'],
      inputs: { topic: 'persistence' },
      expectedOutputs: ['workflow_run'],
      riskLevel: 'low',
      approvalRequired: false,
      constraints: [],
      memoryPolicy: 'candidate_only',
      createdAt: '2026-07-01T00:00:00.000Z'
    });

    expect(created.contract.id).toBe('bc_store_001');
    expect((await service.getContract('bc_store_001'))?.goal).toContain('Persist');

    const run = await service.createPlannedRun({
      workflowDefinitionId: 'wf_ops',
      provider: 'builtin',
      businessContractId: 'bc_store_001',
      input: { hello: 'world' }
    });

    expect(run.id).toBe('run_0001');
    expect((await service.getRun(run.id))?.status).toBe('planned');
  });
});
