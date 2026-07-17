import { describe, expect, it } from 'vitest';
import { WorkflowRegistry } from '../../src/appos/workflows/registry.js';
import { WorkflowRouter } from '../../src/appos/workflows/router.js';

describe('WorkflowRouter', () => {
  it('selects enabled workflow definitions by domain and capability tags', () => {
    const registry = new WorkflowRegistry([
      {
        id: 'wf_content_matrix',
        provider: 'n8n',
        name: 'Content matrix planner',
        domain: 'social_distribution',
        capabilityTags: ['content_matrix', 'cps'],
        inputSchema: {},
        outputSchema: {},
        riskLevel: 'medium',
        approvalPolicy: 'before_external_write',
        providerConfig: { webhookUrl: 'https://n8n.example/webhook/content' },
        resultMapping: {},
        enabled: true
      }
    ]);

    const router = new WorkflowRouter(registry);
    const selected = router.selectWorkflow({
      domain: 'social_distribution',
      capabilityTags: ['cps']
    });

    expect(selected?.id).toBe('wf_content_matrix');
  });

  it('enforces approval policy before external writes', () => {
    const registry = new WorkflowRegistry([]);
    const router = new WorkflowRouter(registry);

    expect(
      router.requiresApproval({
        approvalPolicy: 'before_external_write',
        action: 'external_write'
      })
    ).toBe(true);
  });
});
