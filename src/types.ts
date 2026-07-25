export type TaskStatus =
  | 'new'
  | 'intake'
  | 'planned'
  | 'waiting_approval'
  | 'queued'
  | 'running'
  | 'waiting_external'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled'
  | 'failed';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type RiskLevel = 'low' | 'medium' | 'high';

export type MemoryType =
  | 'strategic'
  | 'operational'
  | 'relationship'
  | 'financial'
  | 'preference'
  | 'playbook'
  | 'pricing';


export interface ASelfProfileRecord {
  id: string;
  display_name: string;
  mission: string;
  profile_markdown: string;
  values_order: string[];
  decision_principles: string[];
  communication_style: Record<string, unknown>;
  boundaries: string[];
  status: string;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ASelfMemoryItemRecord {
  id: string;
  category: string;
  title: string;
  content: string;
  why: string | null;
  tags: string[];
  source: string;
  sensitivity: string;
  confidence: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ASelfDecisionLogRecord {
  id: string;
  decided_at: string;
  question: string;
  choice: string;
  why: string;
  result: string | null;
  review: string | null;
  future_rule: string | null;
  impact: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ASelfPermissionRuleRecord {
  id: string;
  level: number;
  action_type: string;
  automation_mode: string;
  requires_approval: boolean;
  description: string;
  examples: string[];
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ASelfOpcRunRecord {
  id: string;
  run_type: string;
  title: string;
  market_scan: string | null;
  company_state: string | null;
  recommendations: string | null;
  metrics: Record<string, unknown>;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  origin_message_id: string | null;
  parent_task_id: string | null;
  owner_agent: string;
  priority: string;
  risk_level: RiskLevel;
  status: TaskStatus;
  sequence: number | null;
  planning_metadata: Record<string, unknown>;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessAnalyticsFactRecord {
  id: string;
  occurred_at: string;
  grain: string;
  scope: string;
  metric_code: string;
  metric_name: string;
  metric_value: number;
  amount: number | null;
  score: number | null;
  channel: string | null;
  agent: string | null;
  stage: string | null;
  segment: string | null;
  customer: string | null;
  status: string | null;
  note: string | null;
  source_object_type: string | null;
  source_object_id: string | null;
  is_demo: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type BusinessAnalyticsFactParams = {
  id: string;
  occurred_at?: string;
  grain: string;
  scope: string;
  metric_code: string;
  metric_name: string;
  metric_value: number;
  amount?: number | null;
  score?: number | null;
  channel?: string | null;
  agent?: string | null;
  stage?: string | null;
  segment?: string | null;
  customer?: string | null;
  status?: string | null;
  note?: string | null;
  source_object_type?: string | null;
  source_object_id?: string | null;
  is_demo?: boolean;
  metadata?: Record<string, unknown>;
};

export interface TaskDependencyRecord {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TaskEventRecord {
  id: string;
  task_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  task_id: string | null;
  action_type: string;
  status: ApprovalStatus;
  risk_level: RiskLevel;
  prompt: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PendingApprovalRecord extends ApprovalRecord {
  task_title: string | null;
}

export interface AuditLogRecord {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BriefingRecord {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  importance: string;
  created_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ReviewRecord {
  id: string;
  task_id: string;
  outcome: string;
  result_met: boolean;
  lessons: string[];
  next_actions: string[];
  playbook_candidate: string | null;
  created_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PlaybookRecord {
  id: string;
  title: string;
  content: string;
  status: string;
  source_review_id: string | null;
  source_task_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ArtifactRecord {
  id: string;
  task_id: string | null;
  type: string;
  title: string;
  uri: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type OpportunityStage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface OrganizationRecord {
  id: string;
  name: string;
  domain: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organization_id: string | null;
  organization_name?: string | null;
  role: string | null;
  status: string;
  source: string;
  tags: string[];
  notes: string | null;
  last_interaction_at: string | null;
  next_follow_up_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRecord {
  id: string;
  contact_id: string | null;
  organization_id: string | null;
  contact_name?: string | null;
  organization_name?: string | null;
  title: string;
  stage: OpportunityStage;
  value_amount: string | null;
  currency: string;
  expected_close_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRecord {
  id: string;
  contact_id: string;
  opportunity_id: string | null;
  task_id: string | null;
  contact_name?: string | null;
  organization_name?: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  note: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmDashboard {
  hotLeads: ContactRecord[];
  overdueFollowUps: FollowUpRecord[];
  upcomingFollowUps: FollowUpRecord[];
  openOpportunities: OpportunityRecord[];
  riskContacts: ContactRecord[];
}

export type EmailCategory = 'urgent' | 'customer' | 'finance' | 'calendar' | 'newsletter' | 'ignored';

export interface EmailThreadRecord {
  id: string;
  account_id: string | null;
  external_thread_id: string | null;
  contact_id: string | null;
  organization_id: string | null;
  contact_name?: string | null;
  organization_name?: string | null;
  subject: string;
  category: EmailCategory;
  status: string;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmailMessageRecord {
  id: string;
  thread_id: string;
  external_message_id: string | null;
  direction: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  subject: string;
  snippet: string | null;
  body: string | null;
  category: EmailCategory;
  received_at: string;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface EmailDraftRecord {
  id: string;
  thread_id: string | null;
  contact_id: string | null;
  task_id: string | null;
  approval_id: string | null;
  subject: string;
  body: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MailDashboard {
  urgent: EmailThreadRecord[];
  customer: EmailThreadRecord[];
  finance: EmailThreadRecord[];
  calendar: EmailThreadRecord[];
  draftsWaitingApproval: EmailDraftRecord[];
}

export type TransactionDirection = 'income' | 'expense';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface VendorRecord {
  id: string;
  name: string;
  category: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TransactionRecord {
  id: string;
  direction: TransactionDirection;
  amount: string;
  currency: string;
  occurred_at: string;
  category: string | null;
  counterparty: string | null;
  vendor_id: string | null;
  invoice_id: string | null;
  subscription_id: string | null;
  description: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface InvoiceRecord {
  id: string;
  customer_name: string;
  contact_id: string | null;
  organization_id: string | null;
  amount: string;
  currency: string;
  status: InvoiceStatus;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRecord {
  id: string;
  vendor_id: string | null;
  vendor_name?: string | null;
  name: string;
  amount: string;
  currency: string;
  billing_interval: string;
  next_billing_at: string | null;
  status: string;
  category: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FinanceDashboard {
  currency: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  netCashflow: number;
  openInvoices: InvoiceRecord[];
  upcomingSubscriptions: SubscriptionRecord[];
  recentTransactions: TransactionRecord[];
  riskAlerts: string[];
  suggestedActions: string[];
}

export interface CalendarEventRecord {
  id: string;
  account_id: string | null;
  external_event_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  visibility: string;
  attendees: string[];
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MeetingNoteRecord {
  id: string;
  event_id: string | null;
  event_title?: string | null;
  event_starts_at?: string | null;
  note_type: string;
  content: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityWindowRecord {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CalendarDashboard {
  todayEvents: CalendarEventRecord[];
  tomorrowEvents: CalendarEventRecord[];
  conflicts: string[];
  availabilityWindows: AvailabilityWindowRecord[];
  meetingPrep: MeetingNoteRecord[];
}

export interface BrowserRunRecord {
  id: string;
  task_id: string | null;
  session_id: string | null;
  goal: string;
  target_url: string;
  target_domain: string;
  status: string;
  risk_level: RiskLevel;
  source: string;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BrowserStepRecord {
  id: string;
  run_id: string;
  sequence: number;
  action: string;
  target: string | null;
  status: string;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BrowserScreenshotRecord {
  id: string;
  run_id: string;
  step_id: string | null;
  label: string;
  artifact_path: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BrowserExtractionRecord {
  id: string;
  run_id: string;
  extraction_type: string;
  content: Record<string, unknown>;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BrowserBlockedActionRecord {
  id: string;
  run_id: string;
  approval_id: string | null;
  action_type: string;
  reason: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BrowserDashboard {
  recentRuns: BrowserRunRecord[];
  blockedActions: BrowserBlockedActionRecord[];
  recentScreenshots: BrowserScreenshotRecord[];
  recentExtractions: BrowserExtractionRecord[];
}

export interface RetryEventRecord {
  id: string;
  task_id: string | null;
  requested_by_user_id: string | null;
  reason: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface IntegrationHealthCheckRecord {
  id: string;
  integration: string;
  status: string;
  checked_at: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AuditExportRecord {
  id: string;
  status: string;
  format: string;
  scope: string;
  artifact_path: string | null;
  requested_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BackupRunRecord {
  id: string;
  status: string;
  backup_type: string;
  artifact_path: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvaluationCaseRecord {
  id: string;
  name: string;
  category: string;
  prompt: string;
  expected_behavior: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvaluationRunRecord {
  id: string;
  suite: string;
  status: string;
  requested_by_user_id: string | null;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationResultRecord {
  id: string;
  run_id: string;
  case_id: string | null;
  name: string;
  category: string;
  status: string;
  message: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PermissionProfileRecord {
  id: string;
  agent: string;
  permissions: string[];
  approval_required: string[];
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SolutionRunRecord {
  id: string;
  task_id: string | null;
  status: string;
  original_text: string;
  selected_skills: string[];
  problem_statement: string | null;
  assumptions: string[];
  options: Array<Record<string, unknown>>;
  recommendation: string | null;
  risks: string[];
  execution_plan: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvidenceItemRecord {
  id: string;
  task_id: string | null;
  solution_run_id: string | null;
  source_type: string;
  source_ref: string | null;
  summary: string;
  confidence: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AssumptionRecord {
  id: string;
  task_id: string | null;
  solution_run_id: string | null;
  content: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RiskItemRecord {
  id: string;
  task_id: string | null;
  solution_run_id: string | null;
  category: string;
  severity: string;
  content: string;
  mitigation: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProspectingRunRecord {
  id: string;
  task_id: string | null;
  status: string;
  original_text: string;
  icp: Record<string, unknown>;
  selected_skills: string[];
  source_strategy: Array<Record<string, unknown>>;
  scoring_model: Array<Record<string, unknown>>;
  compliance_notes: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LeadSourceRecord {
  id: string;
  prospecting_run_id: string | null;
  name: string;
  source_type: string;
  query: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LeadRecord {
  id: string;
  prospecting_run_id: string | null;
  organization_id: string | null;
  contact_id: string | null;
  name: string;
  status: string;
  source: string;
  score: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LeadScoreRecord {
  id: string;
  lead_id: string;
  prospecting_run_id: string | null;
  score: Record<string, unknown>;
  priority: string;
  reasons: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EnrichmentResultRecord {
  id: string;
  lead_id: string;
  prospecting_run_id: string | null;
  fields: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  confidence: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OutreachSequenceRecord {
  id: string;
  prospecting_run_id: string | null;
  name: string;
  status: string;
  steps: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecord {
  id: string;
  prospecting_run_id: string | null;
  name: string;
  status: string;
  audience: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CampaignEventRecord {
  id: string;
  campaign_id: string | null;
  lead_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AgentRunRecord {
  id: string;
  task_id: string | null;
  agent_id: string;
  provider: string;
  model: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCallRecord {
  id: string;
  agent_run_id: string | null;
  task_id: string | null;
  agent_id: string;
  tool_name: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  approval_required: boolean;
  approval_id: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpsDashboard {
  retriableTasks: TaskRecord[];
  retryEvents: RetryEventRecord[];
  integrationHealthChecks: IntegrationHealthCheckRecord[];
  auditExports: AuditExportRecord[];
  backupRuns: BackupRunRecord[];
  evaluationCases: EvaluationCaseRecord[];
  evaluationRuns: EvaluationRunRecord[];
  permissionProfiles: PermissionProfileRecord[];
}
