export type Channel = 'web' | 'telegram' | 'feishu' | 'voice';

export type SpeechAct =
  | 'question'
  | 'statement'
  | 'command'
  | 'correction'
  | 'fragment'
  | 'approval'
  | 'rejection'
  | 'test';

export type IntentDomain =
  | 'content'
  | 'social_distribution'
  | 'crm'
  | 'finance'
  | 'calendar'
  | 'mail'
  | 'browser'
  | 'ops'
  | 'project'
  | 'memory'
  | 'unknown';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ExpectedOutput = 'artifact' | 'task' | 'workflow_run' | 'approval' | 'external_ref';

export type MemoryPolicy = 'no_write' | 'candidate_only' | 'write_after_review';

export type WorkflowProvider = 'dify' | 'n8n' | 'builtin' | 'http_tool';

export type WorkflowRunStatus =
  | 'planned'
  | 'queued'
  | 'running'
  | 'waiting_callback'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled';

export type ApplicationEventType =
  | 'business_contract_created'
  | 'task_created'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_rejected'
  | 'workflow_started'
  | 'workflow_done'
  | 'workflow_failed'
  | 'artifact_created'
  | 'resource_synced'
  | 'media_job_started'
  | 'media_job_done'
  | 'media_job_failed'
  | 'resource_job_started'
  | 'resource_job_done'
  | 'resource_job_failed'
  | 'external_object_synced';

export interface ChannelAttachment {
  id: string;
  type: string;
  name?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelMessage {
  id: string;
  channel: Channel;
  senderExternalId: string;
  senderDisplayName?: string;
  conversationExternalId: string;
  text: string;
  attachments: ChannelAttachment[];
  rawEventRef: string;
  timestamp: string;
}

export interface MoraIntentPacket {
  id: string;
  sourceUtteranceId: string;
  rawText: string;
  speechAct: SpeechAct;
  intentDomain: IntentDomain;
  entities: Array<Record<string, unknown>>;
  references: Array<Record<string, unknown>>;
  temporalAnchors: Array<Record<string, unknown>>;
  uncertainty: number;
  worldContextRefs: string[];
  selfCore: {
    schemaVersion: string;
    identityScore: number;
    identityStatus: string;
    crisisMode: boolean;
    reasons: string[];
  };
  openAttributes: Record<string, unknown>;
}

export interface BusinessContract {
  id: string;
  sourceIntentPacketId: string;
  sourceUtteranceId: string;
  goal: string;
  domain: IntentDomain;
  successCriteria: string[];
  inputs: Record<string, unknown>;
  expectedOutputs: ExpectedOutput[];
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  approvalReason?: string;
  constraints: string[];
  memoryPolicy: MemoryPolicy;
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowDefinitionId: string;
  provider: WorkflowProvider;
  businessContractId: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
  normalizedOutput?: Record<string, unknown>;
  externalExecutionId?: string;
  traceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalObjectRef {
  id: string;
  provider: string;
  externalType: string;
  externalId: string;
  url?: string;
  localObjectType: string;
  localObjectId: string;
  metadata: Record<string, unknown>;
}

export interface MemoryCandidate {
  id: string;
  source: 'tele-opc';
  type:
    | 'business_rule'
    | 'user_preference'
    | 'workflow_result'
    | 'platform_policy'
    | 'content_preference'
    | 'customer_fact'
    | 'ops_playbook';
  content: string;
  confidence: number;
  evidenceRefs: string[];
  createdAt: string;
}

export interface ApplicationEvent {
  id: string;
  source: 'tele-opc';
  eventType: ApplicationEventType;
  localObjectType: string;
  localObjectId: string;
  summary: string;
  evidenceRefs: string[];
  externalRefs: ExternalObjectRef[];
  memoryCandidates: MemoryCandidate[];
  timestamp: string;
}

export interface FailureEvent {
  id: string;
  source: 'mora' | 'tele-opc' | 'dify' | 'n8n' | 'feishu' | 'telegram' | 'web' | 'provider';
  objectType:
    | 'workflow_run'
    | 'api_call'
    | 'code_test'
    | 'frontend_error'
    | 'user_report'
    | 'provider_error'
    | 'integration_health';
  objectId: string;
  symptom: string;
  evidenceRefs: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  firstSeenAt: string;
}
