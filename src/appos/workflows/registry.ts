import type { IntentDomain, RiskLevel, WorkflowProvider } from '../contracts/types.js';

export type ApprovalPolicy = 'never' | 'before_run' | 'before_external_write' | 'always';

export type WorkflowDefinition = {
  id: string;
  provider: WorkflowProvider;
  name: string;
  domain: IntentDomain;
  capabilityTags: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  riskLevel: RiskLevel;
  approvalPolicy: ApprovalPolicy;
  providerConfig: Record<string, unknown>;
  resultMapping: Record<string, unknown>;
  enabled: boolean;
};

export class WorkflowRegistry {
  constructor(private readonly definitions: WorkflowDefinition[] = []) {}

  list() {
    return [...this.definitions];
  }

  findById(id: string) {
    return this.definitions.find((definition) => definition.id === id);
  }

  findByCapability(input: { domain: IntentDomain; capabilityTags: string[] }) {
    return this.definitions.find(
      (definition) =>
        definition.enabled &&
        definition.domain === input.domain &&
        input.capabilityTags.every((tag) => definition.capabilityTags.includes(tag))
    );
  }
}
