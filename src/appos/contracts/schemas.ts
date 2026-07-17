import { z } from 'zod';
import type { BusinessContract, MoraIntentPacket } from './types.js';

const isoString = z.string().min(1);

export const channelSchema = z.enum(['web', 'telegram', 'feishu', 'voice']);

export const intentDomainSchema = z.enum([
  'content',
  'social_distribution',
  'crm',
  'finance',
  'calendar',
  'mail',
  'browser',
  'ops',
  'project',
  'memory',
  'unknown'
]);

export const riskLevelSchema = z.enum(['low', 'medium', 'high']);

export const channelAttachmentSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  url: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const channelMessageSchema = z.object({
  id: z.string().min(1),
  channel: channelSchema,
  senderExternalId: z.string().min(1),
  senderDisplayName: z.string().optional(),
  conversationExternalId: z.string().min(1),
  text: z.string(),
  attachments: z.array(channelAttachmentSchema),
  rawEventRef: z.string().min(1),
  timestamp: isoString
});

export const moraIntentPacketSchema = z.object({
  id: z.string().min(1),
  sourceUtteranceId: z.string().min(1),
  rawText: z.string().min(1),
  speechAct: z.enum(['question', 'statement', 'command', 'correction', 'fragment', 'approval', 'rejection', 'test']),
  intentDomain: intentDomainSchema,
  entities: z.array(z.record(z.unknown())),
  references: z.array(z.record(z.unknown())),
  temporalAnchors: z.array(z.record(z.unknown())),
  uncertainty: z.number().min(0).max(1),
  worldContextRefs: z.array(z.string()),
  selfCore: z.object({
    schemaVersion: z.string().min(1),
    identityScore: z.number().min(0).max(1),
    identityStatus: z.string().min(1),
    crisisMode: z.boolean(),
    reasons: z.array(z.string())
  }),
  openAttributes: z.record(z.unknown())
});

export const businessContractSchema = z.object({
  id: z.string().min(1),
  sourceIntentPacketId: z.string().min(1),
  sourceUtteranceId: z.string().min(1),
  goal: z.string().min(1),
  domain: intentDomainSchema,
  successCriteria: z.array(z.string().min(1)),
  inputs: z.record(z.unknown()),
  expectedOutputs: z.array(z.enum(['artifact', 'task', 'workflow_run', 'approval', 'external_ref'])).min(1),
  riskLevel: riskLevelSchema,
  approvalRequired: z.boolean(),
  approvalReason: z.string().optional(),
  constraints: z.array(z.string()),
  memoryPolicy: z.enum(['no_write', 'candidate_only', 'write_after_review']),
  createdAt: isoString
});

export const workflowRunSchema = z.object({
  id: z.string().min(1),
  workflowDefinitionId: z.string().min(1),
  provider: z.enum(['dify', 'n8n', 'builtin', 'http_tool']),
  businessContractId: z.string().min(1),
  status: z.enum(['planned', 'queued', 'running', 'waiting_callback', 'reviewing', 'done', 'failed', 'cancelled']),
  input: z.record(z.unknown()),
  rawOutput: z.record(z.unknown()).optional(),
  normalizedOutput: z.record(z.unknown()).optional(),
  externalExecutionId: z.string().optional(),
  traceId: z.string().min(1),
  createdAt: isoString,
  updatedAt: isoString
});

export const externalObjectRefSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  externalType: z.string().min(1),
  externalId: z.string().min(1),
  url: z.string().optional(),
  localObjectType: z.string().min(1),
  localObjectId: z.string().min(1),
  metadata: z.record(z.unknown())
});

export const memoryCandidateSchema = z.object({
  id: z.string().min(1),
  source: z.literal('tele-opc'),
  type: z.enum([
    'business_rule',
    'user_preference',
    'workflow_result',
    'platform_policy',
    'content_preference',
    'customer_fact',
    'ops_playbook'
  ]),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  createdAt: isoString
});

export const applicationEventSchema = z.object({
  id: z.string().min(1),
  source: z.literal('tele-opc'),
  eventType: z.enum([
    'business_contract_created',
    'task_created',
    'approval_requested',
    'approval_approved',
    'approval_rejected',
    'workflow_started',
    'workflow_done',
    'workflow_failed',
    'artifact_created',
    'resource_synced',
    'media_job_started',
    'media_job_done',
    'media_job_failed',
    'resource_job_started',
    'resource_job_done',
    'resource_job_failed',
    'external_object_synced'
  ]),
  localObjectType: z.string().min(1),
  localObjectId: z.string().min(1),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  externalRefs: z.array(externalObjectRefSchema),
  memoryCandidates: z.array(memoryCandidateSchema),
  timestamp: isoString
});

export const failureEventSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['mora', 'tele-opc', 'dify', 'n8n', 'feishu', 'telegram', 'web', 'provider']),
  objectType: z.enum([
    'workflow_run',
    'api_call',
    'code_test',
    'frontend_error',
    'user_report',
    'provider_error',
    'integration_health'
  ]),
  objectId: z.string().min(1),
  symptom: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  firstSeenAt: isoString
});

export function createBusinessContractFromMoraIntent(
  intent: MoraIntentPacket,
  createdAt = new Date().toISOString()
): BusinessContract {
  return businessContractSchema.parse({
    id: `bc_${intent.id}`,
    sourceIntentPacketId: intent.id,
    sourceUtteranceId: intent.sourceUtteranceId,
    goal: intent.rawText,
    domain: intent.intentDomain,
    successCriteria: ['Create a workflow run', 'Create reviewable artifact output', 'Request approval before external publishing'],
    inputs: {
      entities: intent.entities,
      references: intent.references,
      temporalAnchors: intent.temporalAnchors,
      openAttributes: intent.openAttributes,
      worldContextRefs: intent.worldContextRefs
    },
    expectedOutputs: ['workflow_run', 'artifact', 'approval'],
    riskLevel: intent.intentDomain === 'finance' ? 'high' : intent.intentDomain === 'social_distribution' ? 'medium' : 'low',
    approvalRequired: intent.intentDomain === 'finance' || intent.intentDomain === 'social_distribution',
    approvalReason:
      intent.intentDomain === 'social_distribution'
        ? 'External publishing and content distribution require owner review'
        : undefined,
    constraints: ['Mora frozen', 'No direct Mora memory writes', 'No automatic external publishing'],
    memoryPolicy: 'candidate_only',
    createdAt
  });
}
