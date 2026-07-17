import type { IntentDomain } from '../contracts/types.js';
import type { ApprovalPolicy, WorkflowDefinition, WorkflowRegistry } from './registry.js';

export class WorkflowRouter {
  constructor(private readonly registry: WorkflowRegistry) {}

  selectWorkflow(input: { domain: IntentDomain; capabilityTags: string[] }): WorkflowDefinition | undefined {
    return this.registry.findByCapability(input);
  }

  requiresApproval(input: { approvalPolicy: ApprovalPolicy; action: 'run' | 'external_write' }) {
    if (input.approvalPolicy === 'always') return true;
    if (input.approvalPolicy === 'before_run') return input.action === 'run';
    if (input.approvalPolicy === 'before_external_write') return input.action === 'external_write';
    return false;
  }
}
