import { fetch } from 'undici';
import type { AppConfig } from '../config/index.js';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  temperature?: number;
}

export interface ChatCompletionResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  raw: Record<string, unknown>;
}

export interface ModelProvider {
  provider: string;
  model: string;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly provider: string;
  readonly model: string;

  constructor(
    params: {
      provider: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs?: number;
    }
  ) {
    this.provider = params.provider;
    this.baseUrl = params.baseUrl.replace(/\/+$/, '');
    this.apiKey = params.apiKey;
    this.model = params.model;
    this.timeoutMs = params.timeoutMs ?? 60000;
  }

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages.map(toOpenAIMessage),
        tools: request.tools,
        tool_choice: request.tools?.length ? 'auto' : undefined,
        temperature: request.temperature ?? 0.2
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof payload.error === 'object' && payload.error
        ? JSON.stringify(payload.error)
        : response.statusText;
      throw new Error(`model_request_failed:${response.status}:${message}`);
    }

    const choice = firstChoice(payload);
    const message = isRecord(choice?.message) ? choice.message : {};
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map(parseToolCall).filter((item): item is ToolCallRequest => Boolean(item))
      : [];

    return {
      content,
      toolCalls,
      raw: payload
    };
  }
}

export function createModelProviderFromConfig(config: AppConfig): ModelProvider | null {
  if (!config.ai.agentEnabled || !config.ai.openaiApiKey) return null;
  return new OpenAICompatibleModelProvider({
    provider: config.ai.provider || 'openai',
    baseUrl: config.ai.openaiBaseUrl,
    apiKey: config.ai.openaiApiKey,
    model: config.ai.openaiModel,
    timeoutMs: config.ai.openaiTimeoutMs
  });
}

function toOpenAIMessage(message: ChatMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content ?? ''
    };
  }

  return {
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls
  };
}

function firstChoice(payload: Record<string, unknown>) {
  const choices = payload.choices;
  return Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : null;
}

function parseToolCall(value: unknown): ToolCallRequest | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const fn = isRecord(value.function) ? value.function : null;
  const name = typeof fn?.name === 'string' ? fn.name : '';
  const rawArguments = typeof fn?.arguments === 'string' ? fn.arguments : '{}';
  if (!id || !name) return null;
  return {
    id,
    name,
    arguments: parseJsonObject(rawArguments)
  };
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
