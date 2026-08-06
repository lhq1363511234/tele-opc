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
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
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
    const body = JSON.stringify({
      model: this.model,
      messages: request.messages.map(toOpenAIMessage),
      tools: request.tools,
      tool_choice: request.tools?.length ? 'auto' : undefined,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens,
      reasoning_effort: request.reasoningEffort
    });
    const retryDelaysMs = [0, 700, 1800].slice(0, Math.max(1, Math.min(3, (request.maxRetries ?? 2) + 1)));
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    let lastError: unknown;

    for (const [attempt, delayMs] of retryDelaysMs.entries()) {
      if (delayMs) await sleep(delayMs);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json'
          },
          body,
          signal: AbortSignal.timeout(timeoutMs)
        });

        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const message = typeof payload.error === 'object' && payload.error
            ? JSON.stringify(payload.error)
            : response.statusText;
          const error = new Error(`model_request_failed:${response.status}:${message}`);
          if (attempt < retryDelaysMs.length - 1 && isRetryableModelStatus(response.status)) {
            lastError = error;
            continue;
          }
          throw error;
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
      } catch (error) {
        lastError = error;
        if (attempt >= retryDelaysMs.length - 1 || !isRetryableModelError(error)) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('model_request_failed:unknown');
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


function isRetryableModelStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableModelError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /model_request_failed:(408|409|429|502|503|504):|fetch failed|timeout|aborted|socket/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
