import {
  applicationEventSchema,
  businessContractSchema,
  failureEventSchema,
  workflowRunSchema
} from '../contracts/schemas.js';
import type { ApplicationEvent, BusinessContract, FailureEvent, WorkflowRun, WorkflowProvider } from '../contracts/types.js';

type PlannedRunInput = {
  workflowDefinitionId: string;
  provider: WorkflowProvider;
  businessContractId: string;
  input: Record<string, unknown>;
};

export class AppOSGatewayService {
  private contracts = new Map<string, BusinessContract>();
  private events: ApplicationEvent[] = [];
  private runs = new Map<string, WorkflowRun>();
  private failures: FailureEvent[] = [];
  private runSequence = 0;

  createContract(payload: unknown) {
    const contract = businessContractSchema.parse(payload);
    this.contracts.set(contract.id, contract);

    const event = applicationEventSchema.parse({
      id: `evt_${contract.id}`,
      source: 'tele-opc',
      eventType: 'business_contract_created',
      localObjectType: 'business_contract',
      localObjectId: contract.id,
      summary: contract.goal,
      evidenceRefs: [contract.sourceUtteranceId],
      externalRefs: [],
      memoryCandidates: [],
      timestamp: contract.createdAt
    });

    this.events.push(event);
    return { contract, event };
  }

  getContract(id: string) {
    return this.contracts.get(id);
  }

  storeEvent(payload: unknown) {
    const event = applicationEventSchema.parse(payload);
    this.events.push(event);
    return event;
  }

  listEvents() {
    return [...this.events];
  }

  createPlannedRun(input: PlannedRunInput) {
    this.runSequence += 1;
    const now = new Date().toISOString();
    const run = workflowRunSchema.parse({
      id: `run_${String(this.runSequence).padStart(4, '0')}`,
      workflowDefinitionId: input.workflowDefinitionId,
      provider: input.provider,
      businessContractId: input.businessContractId,
      status: 'planned',
      input: input.input,
      traceId: `trace_${String(this.runSequence).padStart(4, '0')}`,
      createdAt: now,
      updatedAt: now
    });
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string) {
    return this.runs.get(id);
  }

  updateRunFromN8nCallback(payload: {
    runId: string;
    status: WorkflowRun['status'];
    output?: Record<string, unknown>;
    error?: { message?: string; [key: string]: unknown };
    externalExecutionId?: string;
  }) {
    const current = this.runs.get(payload.runId);
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    const updated = workflowRunSchema.parse({
      ...current,
      status: payload.status,
      normalizedOutput: payload.output,
      rawOutput: payload.output,
      externalExecutionId: payload.externalExecutionId ?? current.externalExecutionId,
      updatedAt: now
    });
    this.runs.set(updated.id, updated);

    if (payload.status !== 'failed') {
      const event = this.storeEvent({
        id: `evt_${updated.id}_${payload.status}`,
        source: 'tele-opc',
        eventType: payload.status === 'done' ? 'workflow_done' : 'workflow_started',
        localObjectType: 'workflow_run',
        localObjectId: updated.id,
        summary: `Workflow ${payload.status}`,
        evidenceRefs: [updated.traceId],
        externalRefs: [],
        memoryCandidates: [],
        timestamp: now
      });
      return { run: updated, event };
    }

    const failure = failureEventSchema.parse({
      id: `fail_${updated.id}_${Date.now()}`,
      source: 'n8n',
      objectType: 'workflow_run',
      objectId: updated.id,
      symptom: payload.error?.message ?? 'n8n workflow failed',
      evidenceRefs: [updated.traceId],
      severity: 'medium',
      firstSeenAt: now
    });
    this.failures.push(failure);
    return { run: updated, failure };
  }

  listFailures() {
    return [...this.failures];
  }
}
