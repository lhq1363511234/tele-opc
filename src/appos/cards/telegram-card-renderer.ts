import type { RiskLevel } from '../contracts/types.js';
import { applicationEventSchema } from '../contracts/schemas.js';

type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

type TelegramCard = {
  text: string;
  reply_markup: {
    inline_keyboard: InlineButton[][];
  };
};

export function renderTelegramTaskStatusCard(input: {
  id: string;
  title: string;
  status: string;
  currentStep: string;
  previewUrl?: string;
}): TelegramCard {
  const buttons: InlineButton[] = [
    { text: '打开任务', callback_data: `appos:task:open:${input.id}` },
    input.previewUrl
      ? { text: '打开预览', url: input.previewUrl }
      : { text: '打开预览', callback_data: `appos:task:preview:${input.id}` },
    { text: '继续修改', callback_data: `appos:task:revise:${input.id}` },
    { text: '取消', callback_data: `appos:task:cancel:${input.id}` }
  ];

  return {
    text: `${input.id}  ${input.title}\n状态：${input.status}\n当前：${input.currentStep}`,
    reply_markup: {
      inline_keyboard: [buttons.slice(0, 2), buttons.slice(2)]
    }
  };
}

export function renderTelegramApprovalCard(input: {
  approvalId: string;
  title: string;
  riskLevel: RiskLevel;
  reason: string;
}): TelegramCard {
  return {
    text: `审批：${input.title}\n风险：${input.riskLevel}\n原因：${input.reason}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '批准', callback_data: `appos:approval:${input.approvalId}:approved` },
          { text: '拒绝', callback_data: `appos:approval:${input.approvalId}:rejected` }
        ]
      ]
    }
  };
}

export function parseTelegramApprovalCallback(callbackData: string) {
  const match = /^appos:approval:([^:]+):(approved|rejected)$/.exec(callbackData);
  if (!match) {
    return null;
  }
  return {
    approvalId: match[1],
    decision: match[2] as 'approved' | 'rejected'
  };
}

export function telegramApprovalCallbackToEvent(callbackData: string, timestamp = new Date().toISOString()) {
  const parsed = parseTelegramApprovalCallback(callbackData);
  if (!parsed) {
    return null;
  }

  return applicationEventSchema.parse({
    id: `evt_telegram_${parsed.approvalId}_${parsed.decision}`,
    source: 'tele-opc',
    eventType: parsed.decision === 'approved' ? 'approval_approved' : 'approval_rejected',
    localObjectType: 'approval',
    localObjectId: parsed.approvalId,
    summary: `Telegram approval ${parsed.decision}`,
    evidenceRefs: [callbackData],
    externalRefs: [],
    memoryCandidates: [],
    timestamp
  });
}
