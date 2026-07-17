import { describe, expect, it } from 'vitest';
import { createFailureEvent, diagnoseFailure, planRepair, repairPlanToPolicyCandidate } from '../../src/appos/repair/failure-service.js';

describe('repair MVP', () => {
  it('creates a failure event from a provider error', () => {
    const failure = createFailureEvent({
      source: 'dify',
      objectType: 'workflow_run',
      objectId: 'run_001',
      symptom: 'schema mismatch',
      severity: 'medium',
      evidenceRefs: ['trace_001']
    });

    expect(failure.source).toBe('dify');
    expect(failure.symptom).toBe('schema mismatch');
  });

  it('diagnoses schema mismatch and creates a repair plan', () => {
    const failure = createFailureEvent({
      source: 'dify',
      objectType: 'workflow_run',
      objectId: 'run_001',
      symptom: 'output schema mismatch',
      severity: 'medium',
      evidenceRefs: ['trace_001']
    });

    const diagnosis = diagnoseFailure(failure);
    const repair = planRepair(diagnosis);

    expect(diagnosis.rootCauseHypotheses[0].cause).toBe('schema_mismatch');
    expect(repair.target).toBe('data_mapping');
    expect(repair.requiresApproval).toBe(true);
  });

  it('stores successful repairs as policy candidates', () => {
    const failure = createFailureEvent({
      source: 'dify',
      objectType: 'workflow_run',
      objectId: 'run_001',
      symptom: 'output schema mismatch',
      severity: 'medium',
      evidenceRefs: ['trace_001']
    });

    const policy = repairPlanToPolicyCandidate(planRepair(diagnoseFailure(failure)), ['run_001']);

    expect(policy.status).toBe('candidate');
    expect(policy.evidenceRunIds).toEqual(['run_001']);
  });
});
