import { getAgentDefinition, isKnownAgent, listAgentDefinitions } from '../agents/registry.js';
import { selectSkillsForText } from '../skills/registry.js';
import type { MemoryType, TaskStatus } from '../types.js';
import type { AgentTool } from './agentRunner.js';

export interface AgentToolRepositories {
  listMemories(params?: { limit?: number; type?: MemoryType }): Promise<Array<{
    id: string;
    type: MemoryType;
    content: string;
    importance: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>>;
  listTasks(limit?: number): Promise<Array<{
    id: string;
    title: string;
    description: string | null;
    owner_agent: string;
    priority: string;
    risk_level: string;
    status: TaskStatus;
    planning_metadata: Record<string, unknown>;
    result: string | null;
    created_at: string;
    updated_at: string;
  }>>;
  listTasksByStatuses(statuses: TaskStatus[], limit?: number): Promise<Array<{
    id: string;
    title: string;
    description: string | null;
    owner_agent: string;
    priority: string;
    risk_level: string;
    status: TaskStatus;
    planning_metadata: Record<string, unknown>;
    result: string | null;
    created_at: string;
    updated_at: string;
  }>>;
  listRecentMessagesForChat(chatId: string, limit?: number): Promise<Array<{
    id: string;
    direction: string;
    text: string | null;
    created_at: string;
  }>>;
  listPendingApprovals(limit?: number): Promise<Array<{
    id: string;
    task_id: string | null;
    task_title: string | null;
    action_type: string;
    status: string;
    risk_level: string;
    prompt: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>>;
}

const SPECIALIST_HANDOFF_AGENT_IDS = new Set([
  'solution',
  'research',
  'prospecting',
  'quote',
  'crm',
  'email',
  'calendar',
  'finance',
  'browser',
  'content',
  'dev',
  'ops'
]);

const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  'new',
  'intake',
  'planned',
  'waiting_approval',
  'queued',
  'running',
  'waiting_external',
  'blocked',
  'review',
  'failed'
];

const TASK_STATUSES: TaskStatus[] = [
  ...ACTIVE_TASK_STATUSES,
  'done',
  'cancelled'
];

export function buildCoreAgentTools(repos: AgentToolRepositories, options: { chatId?: string } = {}): AgentTool[] {
  return [
    {
      name: 'list_agents',
      description: 'List available Tele-OPC agents, capabilities, and approval boundaries.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      async execute() {
        return {
          agents: listAgentDefinitions().map((agent) => ({
            id: agent.id,
            name: agent.displayName,
            role: agent.role,
            mode: agent.mode,
            capabilities: agent.capabilities,
            approvalRequiredFor: agent.approvalRequiredFor
          }))
        };
      }
    },
    {
      name: 'plan_specialist_handoff',
      description: 'Create a validated multi-agent specialist handoff plan for the Chief Agent to execute.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'The owner goal or user request being delegated.'
          },
          agents: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specialist agent IDs to run, such as solution, research, prospecting, quote, crm, email, calendar, finance, browser, content, dev, or ops.'
          },
          executionMode: {
            type: 'string',
            enum: ['parallel', 'sequence'],
            description: 'Use parallel for read-only/planning specialists; use sequence when later agents depend on earlier outputs.'
          },
          reason: {
            type: 'string',
            description: 'Why these specialists should be called.'
          }
        },
        required: ['goal', 'agents'],
        additionalProperties: false
      },
      async execute(input) {
        const requestedAgents = Array.isArray(input.agents)
          ? input.agents.filter((agentId): agentId is string => typeof agentId === 'string')
          : [];
        const acceptedAgentIds = uniqueStrings(requestedAgents)
          .filter((agentId) => isKnownAgent(agentId) && SPECIALIST_HANDOFF_AGENT_IDS.has(agentId))
          .slice(0, 6);
        const rejectedAgentIds = uniqueStrings(requestedAgents)
          .filter((agentId) => !acceptedAgentIds.includes(agentId));
        const executionMode = input.executionMode === 'sequence' ? 'sequence' : 'parallel';

        return {
          goal: typeof input.goal === 'string' ? input.goal.slice(0, 1000) : '',
          executionMode,
          agents: acceptedAgentIds.map((agentId) => {
            const agent = getAgentDefinition(agentId);
            return {
              agentId,
              name: agent.displayName,
              role: agent.role,
              mode: agent.mode,
              approvalRequiredFor: agent.approvalRequiredFor
            };
          }),
          rejectedAgentIds,
          reason: typeof input.reason === 'string' ? input.reason.slice(0, 1000) : '',
          safety: [
            'This is a handoff plan, not an external side effect.',
            'Finance, non-email external writes, external forms, production deploys, billing changes, and destructive actions remain approval-gated. Email campaigns use the dedicated mail sender.'
          ]
        };
      }
    },
    {
      name: 'external_write_request',
      description: 'Request a real non-email external write action such as creating external calendar invites, submitting forms, paying, deploying, publishing, or changing billing. This always requires approval.',
      approvalRequired: true,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'The external write action being requested.'
          },
          target: {
            type: 'string',
            description: 'External system, recipient, account, page, or deployment target.'
          },
          payloadSummary: {
            type: 'string',
            description: 'Human-readable summary of what would be written externally.'
          },
          riskReason: {
            type: 'string',
            description: 'Why this write requires approval.'
          }
        },
        required: ['action', 'target', 'payloadSummary'],
        additionalProperties: false
      },
      async execute() {
        return {
          blocked: true,
          reason: 'approval_required'
        };
      }
    },
    {
      name: 'select_skills',
      description: 'Select relevant Industry, Function, and Execution Skills for a user request.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The user request to route.'
          },
          preferredFunctionSkillIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional function skill IDs to force include.'
          }
        },
        required: ['text'],
        additionalProperties: false
      },
      async execute(input) {
        const text = typeof input.text === 'string' ? input.text : '';
        const preferredFunctionSkillIds = Array.isArray(input.preferredFunctionSkillIds)
          ? input.preferredFunctionSkillIds.filter((item): item is string => typeof item === 'string')
          : [];
        const selection = selectSkillsForText(text, preferredFunctionSkillIds);
        return {
          industrySkills: selection.industrySkills.map(compactSkill),
          functionSkills: selection.functionSkills.map(compactSkill),
          executionSkills: selection.executionSkills.map(compactSkill),
          reasons: selection.reasons
        };
      }
    },
    {
      name: 'list_memories',
      description: 'Read recent company memories, preferences, playbooks, or pricing rules. Memories are not the same as tasks or recent chat state.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['strategic', 'operational', 'relationship', 'financial', 'preference', 'playbook', 'pricing']
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 20
          }
        },
        additionalProperties: false
      },
      async execute(input) {
        const type = typeof input.type === 'string' && isMemoryType(input.type) ? input.type : undefined;
        const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 5;
        const memories = await repos.listMemories({ type, limit });
        return {
          memories: memories.map((memory) => ({
            id: memory.id,
            type: memory.type,
            importance: memory.importance,
            content: memory.content.slice(0, 1000),
            metadata: memory.metadata,
            createdAt: memory.created_at
          }))
        };
      }
    },
    {
      name: 'list_recent_tasks',
      description: 'Read recent Tele-OPC tasks. Use this before saying there is no task signal; task state is stored separately from memories.',
      parameters: {
        type: 'object',
        properties: {
          statuses: {
            type: 'array',
            items: {
              type: 'string',
              enum: TASK_STATUSES
            },
            description: 'Optional task statuses to filter by.'
          },
          activeOnly: {
            type: 'boolean',
            description: 'When true, return active unfinished task statuses.'
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 20
          }
        },
        additionalProperties: false
      },
      async execute(input) {
        const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 10;
        const statuses = parseTaskStatuses(input.statuses);
        const activeOnly = input.activeOnly === true;
        const tasks = statuses.length
          ? await repos.listTasksByStatuses(statuses, limit)
          : activeOnly
            ? await repos.listTasksByStatuses(ACTIVE_TASK_STATUSES, limit)
            : await repos.listTasks(limit);
        return {
          tasks: tasks.map(compactTask)
        };
      }
    },
    {
      name: 'list_recent_messages',
      description: 'Read recent Telegram messages for this chat so short replies like "继续" can be interpreted with context.',
      parameters: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Optional Telegram chat id. Defaults to the current chat when available.'
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 20
          }
        },
        additionalProperties: false
      },
      async execute(input) {
        const chatId = typeof input.chatId === 'string' && input.chatId.trim()
          ? input.chatId.trim()
          : options.chatId;
        if (!chatId) {
          return {
            messages: [],
            warning: 'chat_id_missing'
          };
        }
        const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 10;
        const messages = await repos.listRecentMessagesForChat(chatId, limit);
        return {
          chatId,
          messages: messages.map(compactMessage)
        };
      }
    },
    {
      name: 'list_pending_approvals',
      description: 'Read pending approval gates. Finance, payment, paid data, ads, non-email external writes, production deploys, and destructive actions stay gated.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 20
          }
        },
        additionalProperties: false
      },
      async execute(input) {
        const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(20, Math.floor(input.limit))) : 10;
        const approvals = await repos.listPendingApprovals(limit);
        return {
          approvals: approvals.map((approval) => ({
            id: approval.id,
            taskId: approval.task_id,
            taskTitle: approval.task_title,
            actionType: approval.action_type,
            status: approval.status,
            riskLevel: approval.risk_level,
            prompt: approval.prompt.slice(0, 1000),
            createdAt: approval.created_at
          }))
        };
      }
    }
  ];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactSkill(skill: {
  id: string;
  displayName: string;
  summary: string;
  tools: string[];
  riskNotes: string[];
}) {
  return {
    id: skill.id,
    name: skill.displayName,
    summary: skill.summary,
    tools: skill.tools,
    riskNotes: skill.riskNotes
  };
}

function isMemoryType(value: string): value is MemoryType {
  return ['strategic', 'operational', 'relationship', 'financial', 'preference', 'playbook', 'pricing'].includes(value);
}

function parseTaskStatuses(value: unknown): TaskStatus[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === 'string'))
    .filter((item): item is TaskStatus => isTaskStatus(item));
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function compactTask(task: {
  id: string;
  title: string;
  description: string | null;
  owner_agent: string;
  priority: string;
  risk_level: string;
  status: TaskStatus;
  planning_metadata: Record<string, unknown>;
  result: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: task.id,
    title: task.title,
    description: task.description?.slice(0, 1000) ?? null,
    ownerAgent: task.owner_agent,
    priority: task.priority,
    riskLevel: task.risk_level,
    status: task.status,
    planningMetadata: task.planning_metadata,
    result: task.result?.slice(0, 1000) ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at
  };
}

function compactMessage(message: {
  id: string;
  direction: string;
  text: string | null;
  created_at: string;
}) {
  return {
    id: message.id,
    direction: message.direction,
    text: message.text?.slice(0, 1000) ?? null,
    createdAt: message.created_at
  };
}
