import { businessContractSchema } from '../contracts/schemas.js';
import type { BusinessContract, ChannelMessage, IntentDomain } from '../contracts/types.js';
import { msTimestampToIso } from './channel-message.js';

type FeishuMessageEvent = {
  event_id?: string;
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      content?: string;
      create_time?: string;
    };
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
      };
      sender_type?: string;
    };
  };
};

const extractText = (content: string | undefined) => {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : content;
  } catch {
    return content;
  }
};

const inferDomain = (text: string): IntentDomain => {
  const lower = text.toLowerCase();
  if (text.includes('矩阵') || lower.includes('cps') || text.includes('小红书') || text.includes('抖音')) {
    return 'social_distribution';
  }
  if (text.includes('邮件')) return 'mail';
  if (text.includes('客户') || text.includes('线索')) return 'crm';
  if (text.includes('发票') || text.includes('现金流')) return 'finance';
  return 'unknown';
};

export function normalizeFeishuEvent(event: FeishuMessageEvent): ChannelMessage {
  const message = event.event?.message;
  const sender = event.event?.sender;
  const messageId = message?.message_id ?? event.event_id ?? crypto.randomUUID();

  return {
    id: messageId,
    channel: 'feishu',
    senderExternalId: sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? 'unknown',
    conversationExternalId: message?.chat_id ?? 'unknown',
    text: extractText(message?.content),
    attachments: [],
    rawEventRef: `feishu:event:${event.event_id ?? messageId}`,
    timestamp: msTimestampToIso(message?.create_time)
  };
}

export function createBusinessContractFromChannelMessage(message: ChannelMessage): BusinessContract {
  const domain = inferDomain(message.text);
  const approvalRequired = domain === 'social_distribution' || domain === 'finance';

  return businessContractSchema.parse({
    id: `bc_${message.channel}_${message.id}`,
    sourceIntentPacketId: `${message.channel}:${message.id}`,
    sourceUtteranceId: `${message.channel}:message:${message.id}`,
    goal: message.text,
    domain,
    successCriteria: ['Create a workflow run', 'Create reviewable outputs', 'Request approval before external publishing'],
    inputs: {
      channel: message.channel,
      text: message.text,
      attachments: message.attachments,
      conversationExternalId: message.conversationExternalId
    },
    expectedOutputs: ['workflow_run', 'artifact', 'approval'],
    riskLevel: approvalRequired ? 'medium' : 'low',
    approvalRequired,
    approvalReason: approvalRequired ? 'External write or distribution requires owner approval' : undefined,
    constraints: ['Mora frozen', 'No direct Mora memory writes', 'No automatic external publishing'],
    memoryPolicy: 'candidate_only',
    createdAt: message.timestamp
  });
}

export function renderFeishuStatusCard(input: {
  title: string;
  status: string;
  summary: string;
  links?: Array<{ text: string; url: string }>;
}) {
  return {
    config: {
      wide_screen_mode: true
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${input.title}**\n状态：${input.status}\n${input.summary}`
        }
      },
      ...(input.links ?? []).map((link) => ({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: link.text },
            type: 'primary',
            url: link.url
          }
        ]
      }))
    ]
  };
}
