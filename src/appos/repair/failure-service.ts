import { failureEventSchema } from '../contracts/schemas.js';
import type { FailureEvent } from '../contracts/types.js';

export type Diagnosis = {
  id: string;
  failureEventId: string;
  rootCauseHypotheses: Array<{
    cause:
      | 'schema_mismatch'
      | 'missing_config'
      | 'credential_expired'
      | 'permission_denied'
      | 'network_error'
      | 'provider_output_malformed'
      | 'workflow_node_failed'
      | 'code_bug'
      | 'frontend_bug'
      | 'data_conflict'
      | 'semantic_resolution_error'
      | 'unknown';
    confidence: number;
    evidenceRefs: string[];
  }>;
  affectedComponents: string[];
  reproducible: boolean;
  suggestedRepairType:
    | 'retry'
    | 'config_patch'
    | 'schema_mapping_patch'
    | 'workflow_patch'
    | 'code_patch'
    | 'prompt_patch'
    | 'manual_intervention';
};

export type RepairPlan = {
  id: string;
  diagnosisId: string;
  target: 'n8n_workflow' | 'dify_workflow' | 'mora_code' | 'tele_opc_code' | 'config' | 'prompt' | 'data_mapping' | 'platform_policy';
  patch: Record<string, unknown>;
  expectedEffect: string;
  rollbackPlan: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  createdAt: string;
};

export type RepairPolicy = {
  id: string;
  condition: string;
  action: string;
  confidence: number;
  evidenceRunIds: string[];
  regressionCount: number;
  status: 'candidate' | 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
};

export function createFailureEvent(input: Omit<FailureEvent, 'id' | 'firstSeenAt'> & { firstSeenAt?: string }) {
  return failureEventSchema.parse({
    ...input,
    id: `fail_${input.objectId}_${Date.now()}`,
    firstSeenAt: input.firstSeenAt ?? new Date().toISOString()
  });
}

export function diagnoseFailure(failure: FailureEvent): Diagnosis {
  const symptom = failure.symptom.toLowerCase();
  const schemaMismatch = symptom.includes('schema') || symptom.includes('malformed');
  const permission = symptom.includes('permission') || symptom.includes('scope') || symptom.includes('access denied');
  const network = symptom.includes('network') || symptom.includes('timeout') || symptom.includes('econn');

  const cause = schemaMismatch
    ? 'schema_mismatch'
    : permission
      ? 'permission_denied'
      : network
        ? 'network_error'
        : 'unknown';

  return {
    id: `diag_${failure.id}`,
    failureEventId: failure.id,
    rootCauseHypotheses: [{ cause, confidence: cause === 'unknown' ? 0.3 : 0.8, evidenceRefs: failure.evidenceRefs }],
    affectedComponents: [failure.source],
    reproducible: cause !== 'network_error',
    suggestedRepairType: cause === 'schema_mismatch' ? 'schema_mapping_patch' : cause === 'network_error' ? 'retry' : 'manual_intervention'
  };
}

export function planRepair(diagnosis: Diagnosis): RepairPlan {
  const cause = diagnosis.rootCauseHypotheses[0]?.cause ?? 'unknown';
  const schemaMismatch = cause === 'schema_mismatch';

  return {
    id: `repair_${diagnosis.id}`,
    diagnosisId: diagnosis.id,
    target: schemaMismatch ? 'data_mapping' : 'n8n_workflow',
    patch: schemaMismatch ? { action: 'add_output_mapping_guard' } : { action: 'manual_review' },
    expectedEffect: schemaMismatch ? 'Reject malformed provider outputs before writing business objects' : 'Capture enough evidence for manual repair',
    rollbackPlan: 'Disable the repair policy candidate and replay the original failure sample',
    riskLevel: schemaMismatch ? 'medium' : 'high',
    requiresApproval: true,
    createdAt: new Date().toISOString()
  };
}

export function repairPlanToPolicyCandidate(plan: RepairPlan, evidenceRunIds: string[]): RepairPolicy {
  const now = new Date().toISOString();
  return {
    id: `policy_${plan.id}`,
    condition: `diagnosis:${plan.diagnosisId}`,
    action: JSON.stringify(plan.patch),
    confidence: 0.5,
    evidenceRunIds,
    regressionCount: 0,
    status: 'candidate',
    createdAt: now,
    updatedAt: now
  };
}
