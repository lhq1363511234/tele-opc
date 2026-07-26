import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  ApplicationEvent,
  BusinessContract,
  FailureEvent,
  WorkflowRun
} from '../appos/contracts/types.js';

export class AppOSRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createBusinessContract(contract: BusinessContract, metadata: Record<string, unknown> = {}) {
    await this.pool.query(
      `
      INSERT INTO appos_business_contracts (
        id, source_intent_packet_id, source_utterance_id, goal, domain,
        success_criteria, inputs, expected_outputs, risk_level, approval_required,
        approval_reason, constraints, memory_policy, metadata, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6::jsonb,$7::jsonb,$8::jsonb,$9,$10,
        $11,$12::jsonb,$13,$14::jsonb,$15,$15
      )
      ON CONFLICT (id) DO UPDATE SET
        goal = EXCLUDED.goal,
        domain = EXCLUDED.domain,
        success_criteria = EXCLUDED.success_criteria,
        inputs = EXCLUDED.inputs,
        expected_outputs = EXCLUDED.expected_outputs,
        risk_level = EXCLUDED.risk_level,
        approval_required = EXCLUDED.approval_required,
        approval_reason = EXCLUDED.approval_reason,
        constraints = EXCLUDED.constraints,
        memory_policy = EXCLUDED.memory_policy,
        metadata = appos_business_contracts.metadata || EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      `,
      [
        contract.id,
        contract.sourceIntentPacketId,
        contract.sourceUtteranceId,
        contract.goal,
        contract.domain,
        JSON.stringify(contract.successCriteria),
        JSON.stringify(contract.inputs),
        JSON.stringify(contract.expectedOutputs),
        contract.riskLevel,
        contract.approvalRequired,
        contract.approvalReason ?? null,
        JSON.stringify(contract.constraints),
        contract.memoryPolicy,
        JSON.stringify(metadata),
        contract.createdAt
      ]
    );
    return contract;
  }

  async getBusinessContract(id: string): Promise<BusinessContract | null> {
    const result = await this.pool.query(`SELECT * FROM appos_business_contracts WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? mapContract(row) : null;
  }

  async createApplicationEvent(event: ApplicationEvent, payload: Record<string, unknown> = {}) {
    await this.pool.query(
      `
      INSERT INTO appos_application_events (
        id, source, event_type, local_object_type, local_object_id, summary,
        evidence_refs, external_refs, memory_candidates, payload, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [
        event.id,
        event.source,
        event.eventType,
        event.localObjectType,
        event.localObjectId,
        event.summary,
        JSON.stringify(event.evidenceRefs),
        JSON.stringify(event.externalRefs),
        JSON.stringify(event.memoryCandidates),
        JSON.stringify(payload),
        event.timestamp
      ]
    );
    return event;
  }

  async listApplicationEvents(limit = 100): Promise<ApplicationEvent[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM appos_application_events
      ORDER BY created_at ASC
      LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(mapEvent);
  }

  async listApplicationEventsForObject(localObjectType: string, localObjectId: string): Promise<ApplicationEvent[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM appos_application_events
      WHERE local_object_type = $1 AND local_object_id = $2
      ORDER BY created_at ASC
      `,
      [localObjectType, localObjectId]
    );
    return result.rows.map(mapEvent);
  }

  async createWorkflowRun(run: WorkflowRun, metadata: Record<string, unknown> = {}) {
    await this.pool.query(
      `
      INSERT INTO appos_workflow_runs (
        id, workflow_definition_id, provider, business_contract_id, status,
        input, raw_output, normalized_output, external_execution_id, trace_id,
        metadata, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6::jsonb,$7::jsonb,$8::jsonb,$9,$10,
        $11::jsonb,$12,$13
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        input = EXCLUDED.input,
        raw_output = EXCLUDED.raw_output,
        normalized_output = EXCLUDED.normalized_output,
        external_execution_id = EXCLUDED.external_execution_id,
        metadata = appos_workflow_runs.metadata || EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      `,
      [
        run.id,
        run.workflowDefinitionId,
        run.provider,
        run.businessContractId,
        run.status,
        JSON.stringify(run.input),
        run.rawOutput ? JSON.stringify(run.rawOutput) : null,
        run.normalizedOutput ? JSON.stringify(run.normalizedOutput) : null,
        run.externalExecutionId ?? null,
        run.traceId,
        JSON.stringify(metadata),
        run.createdAt,
        run.updatedAt
      ]
    );
    return run;
  }

  async getWorkflowRun(id: string): Promise<WorkflowRun | null> {
    const result = await this.pool.query(`SELECT * FROM appos_workflow_runs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? mapRun(row) : null;
  }

  async updateWorkflowRun(run: WorkflowRun, metadata: Record<string, unknown> = {}) {
    return this.createWorkflowRun(run, metadata);
  }

  async createFailureEvent(failure: FailureEvent, metadata: Record<string, unknown> = {}) {
    await this.pool.query(
      `
      INSERT INTO appos_failure_events (
        id, source, object_type, object_id, symptom, evidence_refs, severity, metadata, first_seen_at, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$9
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [
        failure.id,
        failure.source,
        failure.objectType,
        failure.objectId,
        failure.symptom,
        JSON.stringify(failure.evidenceRefs),
        failure.severity,
        JSON.stringify(metadata),
        failure.firstSeenAt
      ]
    );
    return failure;
  }

  async listFailureEvents(limit = 100): Promise<FailureEvent[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM appos_failure_events
      ORDER BY created_at ASC
      LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(mapFailure);
  }

  async nextRunSequence(): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*)::int AS count FROM appos_workflow_runs`);
    return Number(result.rows[0]?.count ?? 0) + 1;
  }
}

function mapContract(row: any): BusinessContract {
  return {
    id: row.id,
    sourceIntentPacketId: row.source_intent_packet_id,
    sourceUtteranceId: row.source_utterance_id,
    goal: row.goal,
    domain: row.domain,
    successCriteria: row.success_criteria ?? [],
    inputs: row.inputs ?? {},
    expectedOutputs: row.expected_outputs ?? [],
    riskLevel: row.risk_level,
    approvalRequired: row.approval_required,
    approvalReason: row.approval_reason ?? undefined,
    constraints: row.constraints ?? [],
    memoryPolicy: row.memory_policy,
    createdAt: toIso(row.created_at)
  };
}

function mapRun(row: any): WorkflowRun {
  return {
    id: row.id,
    workflowDefinitionId: row.workflow_definition_id,
    provider: row.provider,
    businessContractId: row.business_contract_id,
    status: row.status,
    input: row.input ?? {},
    rawOutput: row.raw_output ?? undefined,
    normalizedOutput: row.normalized_output ?? undefined,
    externalExecutionId: row.external_execution_id ?? undefined,
    traceId: row.trace_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapEvent(row: any): ApplicationEvent {
  return {
    id: row.id,
    source: row.source,
    eventType: row.event_type,
    localObjectType: row.local_object_type,
    localObjectId: row.local_object_id,
    summary: row.summary,
    evidenceRefs: row.evidence_refs ?? [],
    externalRefs: row.external_refs ?? [],
    memoryCandidates: row.memory_candidates ?? [],
    timestamp: toIso(row.created_at)
  };
}

function mapFailure(row: any): FailureEvent {
  return {
    id: row.id,
    source: row.source,
    objectType: row.object_type,
    objectId: row.object_id,
    symptom: row.symptom,
    evidenceRefs: row.evidence_refs ?? [],
    severity: row.severity,
    firstSeenAt: toIso(row.first_seen_at)
  };
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

export function newAppOsId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}
