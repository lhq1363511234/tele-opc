export type AgentToolCallLike = {
  name: string;
  status: string;
  output?: unknown;
};

export type PausedTaskResult = {
  status: 'waiting_approval' | 'review';
  text: string;
};

/**
 * Prevents a worker from marking an Agent run done when the run stopped after
 * tool calls without producing a human-readable, verifiable conclusion.
 */
export function completionPauseForAgentResult(params: {
  content: string;
  toolCalls: AgentToolCallLike[];
  body: string;
}): PausedTaskResult | null {
  const blocked = params.toolCalls.filter((call) => call.status === 'blocked');
  if (blocked.length) {
    const approvalIds = blocked
      .map((call) => isRecord(call.output) ? call.output.approvalId : undefined)
      .filter((id): id is string => typeof id === 'string');
    return {
      status: 'waiting_approval',
      text: [
        params.body,
        '',
        `等待审批：${blocked.map((call) => call.name).join('、')}`,
        ...approvalIds.map((id) => `发送 \`/approve ${id}\` 批准，或 \`/reject ${id}\` 拒绝。`)
      ].join('\n')
    };
  }

  if (!params.content.trim()) {
    const completedTools = params.toolCalls.filter((call) => call.status === 'done').map((call) => call.name);
    return {
      status: 'review',
      text: [
        '执行未达到完成标准：Agent 调用了工具，但没有给出可验收的结果结论，因此不能标记为 done。',
        completedTools.length ? `已调用工具：${[...new Set(completedTools)].join('、')}` : '没有成功的工具调用。',
        '需要补充真实结果、验证证据或明确说明仍缺少的外部条件。'
      ].join('\n')
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
