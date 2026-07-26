import {
  applicationEventSchema,
  businessContractSchema,
  failureEventSchema,
  workflowRunSchema
} from '../contracts/schemas.js';
import type { ApplicationEvent, BusinessContract, FailureEvent, WorkflowRun, WorkflowProvider } from '../contracts/types.js';
import type { AppOSRepository } from '../../db/apposRepository.js';

type PlannedRunInput = {
  workflowDefinitionId: string;
  provider: WorkflowProvider;
  businessContractId: string;
  input: Record<string, unknown>;
};

export interface AppOSStore {
  createBusinessContract(contract: BusinessContract): Promise<BusinessContract> | BusinessContract;
  getBusinessContract(id: string): Promise<BusinessContract | null> | BusinessContract | null;
  storeEvent(event: ApplicationEvent): Promise<ApplicationEvent> | ApplicationEvent;
  listEvents(): Promise<ApplicationEvent[]> | ApplicationEvent[];
  listEventsForObject?(localObjectType: string, localObjectId: string): Promise<ApplicationEvent[]> | ApplicationEvent[];
  createWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> | WorkflowRun;
  getWorkflowRun(id: string): Promise<WorkflowRun | null> | WorkflowRun | null;
  updateWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> | WorkflowRun;
  createFailure(failure: FailureEvent): Promise<FailureEvent> | FailureEvent;
  listFailures(): Promise<FailureEvent[]> | FailureEvent[];
  nextRunSequence(): Promise<number> | number;
}

export class InMemoryAppOSStore implements AppOSStore {
  private contracts = new Map<string, BusinessContract>();
  private events: ApplicationEvent[] = [];
  private runs = new Map<string, WorkflowRun>();
  private failures: FailureEvent[] = [];
  private runSequence = 0;

  createBusinessContract(contract: BusinessContract) {
    this.contracts.set(contract.id, contract);
    return contract;
  }

  getBusinessContract(id: string) {
    return this.contracts.get(id) ?? null;
  }

  storeEvent(event: ApplicationEvent) {
    this.events.push(event);
    return event;
  }

  listEvents() {
    return [...this.events];
  }

  listEventsForObject(localObjectType: string, localObjectId: string) {
    return this.events.filter(
      (event) => event.localObjectType === localObjectType && event.localObjectId === localObjectId
    );
  }

  createWorkflowRun(run: WorkflowRun) {
    this.runs.set(run.id, run);
    return run;
  }

  getWorkflowRun(id: string) {
    return this.runs.get(id) ?? null;
  }

  updateWorkflowRun(run: WorkflowRun) {
    this.runs.set(run.id, run);
    return run;
  }

  createFailure(failure: FailureEvent) {
    this.failures.push(failure);
    return failure;
  }

  listFailures() {
    return [...this.failures];
  }

  nextRunSequence() {
    this.runSequence += 1;
    return this.runSequence;
  }
}

export class PostgresAppOSStore implements AppOSStore {
  constructor(private readonly repo: AppOSRepository) {}

  createBusinessContract(contract: BusinessContract) {
    return this.repo.createBusinessContract(contract);
  }

  getBusinessContract(id: string) {
    return this.repo.getBusinessContract(id);
  }

  storeEvent(event: ApplicationEvent) {
    return this.repo.createApplicationEvent(event);
  }

  listEvents() {
    return this.repo.listApplicationEvents(500);
  }

  listEventsForObject(localObjectType: string, localObjectId: string) {
    return this.repo.listApplicationEventsForObject(localObjectType, localObjectId);
  }

  createWorkflowRun(run: WorkflowRun) {
    return this.repo.createWorkflowRun(run);
  }

  getWorkflowRun(id: string) {
    return this.repo.getWorkflowRun(id);
  }

  updateWorkflowRun(run: WorkflowRun) {
    return this.repo.updateWorkflowRun(run);
  }

  createFailure(failure: FailureEvent) {
    return this.repo.createFailureEvent(failure);
  }

  listFailures() {
    return this.repo.listFailureEvents(200);
  }

  nextRunSequence() {
    return this.repo.nextRunSequence();
  }
}

export class AppOSGatewayService {
  constructor(private readonly store: AppOSStore = new InMemoryAppOSStore()) {}

  async createContract(payload: unknown) {
    const contract = businessContractSchema.parse(payload);
    await this.store.createBusinessContract(contract);

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

    await this.store.storeEvent(event);
    return { contract, event };
  }

  async getContract(id: string) {
    return this.store.getBusinessContract(id);
  }

  async storeEvent(payload: unknown) {
    const event = applicationEventSchema.parse(payload);
    await this.store.storeEvent(event);
    return event;
  }

  async listEvents() {
    return this.store.listEvents();
  }

  async createPlannedRun(input: PlannedRunInput) {
    const sequence = await this.store.nextRunSequence();
    const now = new Date().toISOString();
    const run = workflowRunSchema.parse({
      id: `run_${String(sequence).padStart(4, '0')}`,
      workflowDefinitionId: input.workflowDefinitionId,
      provider: input.provider,
      businessContractId: input.businessContractId,
      status: 'planned',
      input: input.input,
      traceId: `trace_${String(sequence).padStart(4, '0')}`,
      createdAt: now,
      updatedAt: now
    });
    await this.store.createWorkflowRun(run);
    return run;
  }

  async getRun(id: string) {
    return this.store.getWorkflowRun(id);
  }

  async updateRunFromN8nCallback(payload: {
    runId: string;
    status: WorkflowRun['status'];
    output?: Record<string, unknown>;
    error?: { message?: string; [key: string]: unknown };
    externalExecutionId?: string;
  }) {
    const current = await this.store.getWorkflowRun(payload.runId);
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
    await this.store.updateWorkflowRun(updated);

    if (payload.status !== 'failed') {
      const event = await this.storeEvent({
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
    await this.store.createFailure(failure);
    return { run: updated, failure };
  }

  async listFailures() {
    return this.store.listFailures();
  }

  async listEventsForRun(runId: string) {
    if (this.store.listEventsForObject) {
      return this.store.listEventsForObject('workflow_run', runId);
    }
    const events = await this.store.listEvents();
    return events.filter((event) => event.localObjectType === 'workflow_run' && event.localObjectId === runId);
  }
}
