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
