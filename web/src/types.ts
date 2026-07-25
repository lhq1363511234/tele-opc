export type AnyRecord = Record<string, any>;

export interface TaskRecord extends AnyRecord {
  id: string;
  title: string;
  description: string | null;
  origin_message_id: string | null;
  parent_task_id: string | null;
  owner_agent: string;
  status: string;
  risk_level: string;
  priority: string;
  sequence: number | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebCommandResponse {
  ok: boolean;
  reply: string;
  messageId: string;
  task?: TaskRecord;
  currentTask?: TaskRecord;
  subtasks?: TaskRecord[];
  artifacts?: ArtifactRecord[];
}

export interface AgentRunRecord extends AnyRecord {
  id: string;
  task_id: string | null;
  agent_id: string;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ApprovalRecord extends AnyRecord {
  id: string;
  action_type: string;
  risk_level: string;
  task_title: string | null;
  prompt: string;
  created_at: string;
}

export interface ArtifactRecord extends AnyRecord {
  id: string;
  task_id: string | null;
  type: string;
  title: string;
  uri: string | null;
  content: string | null;
  metadata: AnyRecord;
  created_at: string;
}

export interface ArtifactPreviewResponse {
  ok: boolean;
  artifact: ArtifactRecord;
  preview: {
    mode: 'html' | 'text';
    title: string;
    content: string;
    metadata: AnyRecord;
  };
}

export interface OverviewResponse {
  ok: boolean;
  health: {
    database: boolean;
    redis: boolean;
  };
  metrics: {
    tasks: number;
    runningAgentRuns: number;
    pendingApprovals: number;
    blockedTasks: number;
    queuedTasks: number;
    activeAgents: number;
  };
  taskStatusCounts: Record<string, number>;
  tasks: TaskRecord[];
  pendingApprovals: ApprovalRecord[];
  agentRuns: AgentRunRecord[];
  recentMessages: AnyRecord[];
  codexInbox: AnyRecord[];
  dashboards: {
    crm: AnyRecord;
    mail: AnyRecord;
    finance: AnyRecord;
    calendar: AnyRecord;
    browser: AnyRecord;
    ops: AnyRecord;
  };
}

export interface AgentDefinition extends AnyRecord {
  id: string;
  displayName: string;
  role: string;
  mode: string;
  capabilities: string[];
  approvalRequiredFor: string[];
  latestRun?: AgentRunRecord;
  runCount: number;
}

export interface AppDependency extends AnyRecord {
  id: string;
  name: string;
  category: string;
  mode: 'external' | 'managed' | 'disabled';
  baseUrl?: string;
  healthCheckUrl?: string;
  apiKey?: string;
  startCommand?: string;
  stopCommand?: string;
  restartCommand?: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  notes?: string;
}

export interface DependencyListResponse {
  ok: boolean;
  configPath: string;
  dependencies: AppDependency[];
}

export interface DependencyStatusResponse {
  ok: boolean;
  status: {
    id: string;
    ok: boolean;
    status?: number;
    message: string;
    checkedAt: string;
  };
}

export interface PaperclipCompany extends AnyRecord {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  brandColor?: string | null;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
  issuePrefix?: string;
  updatedAt?: string;
}

export interface PaperclipGoal extends AnyRecord {
  id: string;
  title: string;
  description?: string | null;
  level?: string;
  status?: string;
  ownerAgentId?: string | null;
  parentId?: string | null;
  updatedAt?: string;
}

export interface PaperclipProject extends AnyRecord {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  goalId?: string | null;
  goalIds?: string[];
  leadAgentId?: string | null;
  targetDate?: string | null;
  taskCount?: number;
  updatedAt?: string;
}

export interface PaperclipAgent extends AnyRecord {
  id: string;
  name: string;
  role?: string;
  title?: string | null;
  status?: string;
  reportsTo?: string | null;
  capabilities?: string | null;
  adapterType?: string;
  budgetMonthlyCents?: number;
  spentMonthlyCents?: number;
  lastHeartbeatAt?: string | null;
  errorReason?: string | null;
  pauseReason?: string | null;
}

export interface PaperclipLinkedTask extends AnyRecord {
  id: string;
  title: string;
  status: string;
  ownerAgent: string;
  priority: string;
  riskLevel: string;
  result?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaperclipIssue extends AnyRecord {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  projectId?: string | null;
  goalId?: string | null;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastActivityAt?: string | null;
  activeRun?: AnyRecord | null;
  teleOpcTask?: PaperclipLinkedTask | null;
}

export interface PaperclipGovernanceResponse extends AnyRecord {
  ok: boolean;
  connected: boolean;
  generatedAt: string;
  company: PaperclipCompany;
  goals: PaperclipGoal[];
  projects: PaperclipProject[];
  agents: PaperclipAgent[];
  issues: PaperclipIssue[];
  issueCounts: Record<string, number>;
  dashboard: AnyRecord;
  execution: {
    linkedTasks: number;
    received: number;
    done: number;
    failed: number;
    successRate: number;
    byAgent: Array<{ agent: string; received: number; done: number; failed: number }>;
    recentFacts: AnyRecord[];
  };
}

export interface PaperclipIssueDetailResponse extends AnyRecord {
  ok: boolean;
  issue: PaperclipIssue;
  runs: AnyRecord[];
  comments: AnyRecord[];
  facts: AnyRecord[];
}


export interface ASelfProfile extends AnyRecord {
  id: string;
  display_name: string;
  mission: string;
  profile_markdown: string;
  values_order: string[];
  decision_principles: string[];
  communication_style: AnyRecord;
  boundaries: string[];
  status: string;
  confidence: number;
  updated_at: string;
}

export interface ASelfMemoryItem extends AnyRecord {
  id: string;
  category: string;
  title: string;
  content: string;
  why?: string | null;
  tags: string[];
  source: string;
  sensitivity: string;
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ASelfDecisionLog extends AnyRecord {
  id: string;
  decided_at: string;
  question: string;
  choice: string;
  why: string;
  result?: string | null;
  review?: string | null;
  future_rule?: string | null;
  impact: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ASelfPermissionRule extends AnyRecord {
  id: string;
  level: number;
  action_type: string;
  automation_mode: string;
  requires_approval: boolean;
  description: string;
  examples: string[];
  status: string;
}

export interface ASelfOpcRun extends AnyRecord {
  id: string;
  run_type: string;
  title: string;
  market_scan?: string | null;
  company_state?: string | null;
  recommendations?: string | null;
  metrics: AnyRecord;
  status: string;
  created_at: string;
}

export interface ASelfConsoleResponse extends AnyRecord {
  ok: boolean;
  generatedAt: string;
  phase: string;
  profile: ASelfProfile | null;
  metrics: {
    memories: number;
    memoryCategories: number;
    decisions: number;
    decisionRules: number;
    permissionRules: number;
    opcRuns: number;
    confidence: number;
  };
  memoryByCategory: Record<string, number>;
  memories: ASelfMemoryItem[];
  decisions: ASelfDecisionLog[];
  permissions: ASelfPermissionRule[];
  autonomyLevels: Record<string, number>;
  opcRuns: ASelfOpcRun[];
  roadmap: Array<{ phase: string; status: string; description: string }>;
}
