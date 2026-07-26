import type { AgentRunRecord, ToolCallRecord } from '../types.js';
import type { ChatMessage, ChatToolDefinition, ModelProvider, ToolCallRequest } from './modelProvider.js';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  approvalRequired?: boolean;
  execute(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AgentRuntimeRepositories {
  createApproval?(params: {
    taskId?: string;
    actionType: string;
    riskLevel: 'low' | 'medium' | 'high';
    prompt: string;
    payload?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  createAgentRun(params: {
    taskId?: string;
    agentId: string;
    provider: string;
    model: string;
    input: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<AgentRunRecord>;
  updateAgentRun(
    id: string,
    params: {
      status: string;
      output?: Record<string, unknown>;
      error?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<AgentRunRecord>;
  createToolCall(params: {
    agentRunId?: string;
    taskId?: string;
    agentId: string;
    toolName: string;
    input?: Record<string, unknown>;
    approvalRequired?: boolean;
    approvalId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ToolCallRecord>;
  updateToolCall(
    id: string,
    params: {
      status: string;
      output?: Record<string, unknown>;
      error?: string;
      approvalId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<ToolCallRecord>;
}

export interface AgentRunRequest {
  agentId: string;
  systemPrompt: string;
  userText: string;
  taskId?: string;
  context?: Record<string, unknown>;
  tools?: AgentTool[];
  metadata?: Record<string, unknown>;
  maxToolRounds?: number;
}

export interface AgentRunResult {
  runId: string;
  agentId: string;
  provider: string;
  model: string;
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    status: string;
  }>;
}

export class AgentRunner {
  constructor(
    private readonly provider: ModelProvider,
    private readonly repos: AgentRuntimeRepositories
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const tools = request.tools ?? [];
    const agentRun = await this.repos.createAgentRun({
      taskId: request.taskId,
      agentId: request.agentId,
      provider: this.provider.provider,
      model: this.provider.model,
      input: {
        userText: request.userText,
        context: request.context ?? {},
        toolNames: tools.map((tool) => tool.name)
      },
      metadata: request.metadata
    });

    const toolCalls: AgentRunResult['toolCalls'] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        content: [
          request.userText,
          '',
          'Context JSON:',
          JSON.stringify(request.context ?? {}, null, 2)
        ].join('\n')
      }
    ];

    try {
      let content = '';
      const maxToolRounds = request.maxToolRounds ?? 2;
      for (let round = 0; round <= maxToolRounds; round += 1) {
        const response = await this.provider.chat({
          messages,
          tools: tools.length ? tools.map(toChatToolDefinition) : undefined
        });
        content = response.content;

        if (!response.toolCalls.length || round === maxToolRounds) {
          await this.repos.updateAgentRun(agentRun.id, {
            status: 'done',
            output: {
              content,
              toolCalls,
              stoppedAfterRound: round
            }
          });
          return {
            runId: agentRun.id,
            agentId: request.agentId,
            provider: this.provider.provider,
            model: this.provider.model,
            content,
            toolCalls
          };
        }

        messages.push({
          role: 'assistant',
          content: response.content || null,
          toolCalls: response.toolCalls.map(toAssistantToolCall)
        });

        for (const toolCall of response.toolCalls) {
          const result = await this.executeTool({
            agentRun,
            request,
            toolCall,
            tools
          });
          toolCalls.push(result);
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify(result.output ?? { status: result.status })
          });
        }
      }

      await this.repos.updateAgentRun(agentRun.id, {
        status: 'done',
        output: {
          content,
          toolCalls,
          note: 'max_tool_rounds_reached'
        }
      });
      return {
        runId: agentRun.id,
        agentId: request.agentId,
        provider: this.provider.provider,
        model: this.provider.model,
        content,
        toolCalls
      };
    } catch (error) {
      await this.repos.updateAgentRun(agentRun.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'unknown error',
        output: {
          toolCalls
        }
      });
      throw error;
    }
  }

  private async executeTool(params: {
    agentRun: AgentRunRecord;
    request: AgentRunRequest;
    toolCall: ToolCallRequest;
    tools: AgentTool[];
  }) {
    const { agentRun, request, toolCall, tools } = params;
    const tool = tools.find((item) => item.name === toolCall.name);
    const record = await this.repos.createToolCall({
      agentRunId: agentRun.id,
      taskId: request.taskId,
      agentId: request.agentId,
      toolName: toolCall.name,
      input: toolCall.arguments,
      approvalRequired: tool?.approvalRequired ?? false,
      metadata: {
        providerToolCallId: toolCall.id
      }
    });

    if (!tool) {
      await this.repos.updateToolCall(record.id, {
        status: 'failed',
        error: 'unknown_tool',
        output: {
          error: 'unknown_tool',
          toolName: toolCall.name
        }
      });
      return {
        id: record.id,
        name: toolCall.name,
        input: toolCall.arguments,
        output: {
          error: 'unknown_tool',
          toolName: toolCall.name
        },
        status: 'failed'
      };
    }

    if (tool.approvalRequired) {
      const approval = await this.createToolApproval({
        agentRun,
        request,
        toolCall
      });
      const output = {
        blocked: true,
        reason: 'approval_required',
        approvalId: approval?.id
      };
      await this.repos.updateToolCall(record.id, {
        status: 'blocked',
        output,
        approvalId: approval?.id
      });
      return {
        id: record.id,
        name: toolCall.name,
        input: toolCall.arguments,
        output,
        status: 'blocked'
      };
    }

    try {
      const output = await tool.execute(toolCall.arguments);
      await this.repos.updateToolCall(record.id, {
        status: 'done',
        output
      });
      return {
        id: record.id,
        name: toolCall.name,
        input: toolCall.arguments,
        output,
        status: 'done'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      await this.repos.updateToolCall(record.id, {
        status: 'failed',
        error: message,
        output: {
          error: message
        }
      });
      return {
        id: record.id,
        name: toolCall.name,
        input: toolCall.arguments,
        output: {
          error: message
        },
        status: 'failed'
      };
    }
  }

  private async createToolApproval(params: {
    agentRun: AgentRunRecord;
    request: AgentRunRequest;
    toolCall: ToolCallRequest;
  }) {
    if (!this.repos.createApproval) return null;

    const { agentRun, request, toolCall } = params;
    const actionType = typeof toolCall.arguments.action === 'string'
      ? toolCall.arguments.action
      : toolCall.name;
    const target = typeof toolCall.arguments.target === 'string'
      ? toolCall.arguments.target
      : typeof toolCall.arguments.to === 'string'
        ? toolCall.arguments.to
        : typeof toolCall.arguments.table === 'string'
          ? toolCall.arguments.table
          : undefined;
    const payloadSummary = typeof toolCall.arguments.payloadSummary === 'string'
      ? toolCall.arguments.payloadSummary
      : undefined;
    return this.repos.createApproval({
      taskId: request.taskId,
      actionType,
      riskLevel: 'high',
      prompt: [
        `AI Agent 请求外部写入：${actionType}`,
        target ? `目标：${target}` : '',
        payloadSummary ? `内容：${payloadSummary}` : '',
        // Show enough of the real payload that the owner can judge it without
        // digging into the database.
        describeToolArguments(toolCall.arguments)
      ].filter(Boolean).join('\n'),
      payload: {
        source: 'agent_tool_call',
        agentRunId: agentRun.id,
        agentId: request.agentId,
        toolName: toolCall.name,
        input: toolCall.arguments,
        toolInput: toolCall.arguments,
        target,
        payloadSummary
      }
    });
  }
}

/** Renders the fields an owner needs to judge an external action. */
function describeToolArguments(args: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof args.subject === 'string') lines.push(`主题：${args.subject}`);
  if (typeof args.body === 'string') {
    const body = args.body.length > 600 ? `${args.body.slice(0, 600)}…` : args.body;
    lines.push(`正文：\n${body}`);
  }
  if (Array.isArray(args.rows)) lines.push(`行数：${args.rows.length}`);
  if (typeof args.reason === 'string') lines.push(`理由：${args.reason}`);
  return lines.join('\n');
}

function toChatToolDefinition(tool: AgentTool): ChatToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

function toAssistantToolCall(toolCall: ToolCallRequest) {
  return {
    id: toolCall.id,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments)
    }
  };
}
