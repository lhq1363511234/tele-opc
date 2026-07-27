import { randomUUID } from 'node:crypto';
import { AgentRunner } from '../ai/agentRunner.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { ChiefOfStaff } from '../brain/chiefOfStaff.js';
import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import { logger } from '../logger.js';
import { BullMqTaskDispatcher } from '../queue/taskQueue.js';
import { FeishuClient } from './client.js';
import { FeishuAttachmentIngestor } from './attachmentIngestor.js';
import type { FeishuMessageEvent } from './types.js';

export class FeishuGateway {
  private readonly brain: ChiefOfStaff;
  private readonly attachmentIngestor: FeishuAttachmentIngestor;

  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    private readonly client: FeishuClient
  ) {
    const modelProvider = createModelProviderFromConfig(config);
    const agentRunner = modelProvider ? new AgentRunner(modelProvider, repos) : null;
    this.attachmentIngestor = new FeishuAttachmentIngestor(config, repos, client);
    this.brain = new ChiefOfStaff(
      repos,
      new BullMqTaskDispatcher(config.redis.url),
      undefined,
      undefined,
      undefined,
      undefined,
      agentRunner
    );
  }

  async handleEvent(event: FeishuMessageEvent) {
    if (event.chat_type !== 'p2p' || event.sender_type !== 'user') return;
    const isText = event.message_type === 'text';
    const isAttachment = ['file', 'image'].includes(event.message_type);
    if (!isText && !isAttachment) return;
    if (!this.config.feishu.ownerOpenIds.includes(event.sender_id)) {
      await this.repos.audit({
        actorType: 'feishu',
        actorId: event.sender_id,
        action: 'feishu_unauthorized_message',
        metadata: { messageId: event.message_id, chatId: event.chat_id }
      });
      return;
    }

    const ownerContext = await this.repos.getPrimaryOwnerConversation(this.config.telegram.ownerIds);
    if (!ownerContext) {
      await this.client.sendText({ chatId: event.chat_id }, '飞书入口已收到消息，但尚未找到内部所有者身份映射。请先在 Telegram 向机器人发送任意消息完成绑定。');
      return;
    }

    const inbound = await this.repos.createChannelInboundMessage({
      channel: 'feishu',
      externalMessageId: event.message_id,
      externalChatId: event.chat_id,
      externalUserId: event.sender_id,
      userId: ownerContext.userId,
      chatId: ownerContext.chatId,
      text: event.content.trim(),
      raw: event as unknown as Record<string, unknown>
    });
    if (inbound.duplicate) return;

    let reply: string;
    if (isAttachment) {
      await this.client.sendText({ chatId: event.chat_id }, '文件已收到，正在安全下载、识别资料类型并自动处理。');
      try {
        const results = await this.attachmentIngestor.ingest(event, {
          userId: ownerContext.userId,
          chatId: ownerContext.chatId,
          originMessageId: inbound.internalMessageId!
        });
        reply = [
          '附件处理完成：',
          ...results.map((result, index) => [
            `${index + 1}. ${result.fileName}`,
            `类型：${attachmentKindLabel(result.kind)}`,
            `任务：${result.taskId}`,
            `结果：${result.summary}`
          ].join('\n'))
        ].join('\n\n');
      } catch (error) {
        reply = `附件已收到，但自动处理失败：${error instanceof Error ? error.message : String(error)}。原消息不会被重复建任务，你可以修正权限或文件后重新上传。`;
        logger.error({ messageId: event.message_id, error }, 'Feishu attachment ingestion failed');
      }
    } else {
      const normalized = await this.normalizeApprovalReply(event.content.trim(), event.reply_to);
      const acknowledgement = normalized.command
        ? '收到你的审批决定，正在恢复原任务。'
        : '收到。我正在以你的数字本人身份判断并处理。';
      await this.client.sendText({ chatId: event.chat_id }, acknowledgement);
      reply = normalized.response ?? await this.brain.handleText(normalized.command ?? event.content, {
        telegramUserId: ownerContext.telegramUserId,
        userId: ownerContext.userId,
        chatId: ownerContext.chatId,
        originMessageId: inbound.internalMessageId
      });
    }

    const sent = await this.client.sendText({ chatId: event.chat_id }, reply);
    await this.repos.createChannelOutboundMessage({
      id: `chm_${randomUUID()}`,
      channel: 'feishu',
      externalMessageId: sent.messageId,
      externalChatId: event.chat_id,
      externalUserId: event.sender_id,
      chatId: ownerContext.chatId,
      text: reply,
      raw: { source: 'feishu_gateway_reply', replyTo: event.message_id }
    });
  }

  async notifyPendingApprovals() {
    const approvals = await this.repos.listPendingApprovals(50);
    for (const approval of approvals) {
      for (const recipientId of this.config.feishu.ownerOpenIds) {
        const reserved = await this.repos.reserveChannelNotification({
          channel: 'feishu',
          recipientId,
          entityType: 'approval',
          entityId: approval.id,
          metadata: { taskId: approval.task_id, actionType: approval.action_type }
        });
        if (!reserved) continue;
        try {
          const sent = await this.client.sendText({ userId: recipientId }, renderApprovalPrompt(approval));
          await this.repos.completeChannelNotification(reserved.id, sent.messageId);
        } catch (error) {
          await this.repos.deleteChannelNotification(reserved.id);
          logger.error({ approvalId: approval.id, recipientId, error }, 'feishu approval notification failed');
        }
      }
    }
  }

  private async normalizeApprovalReply(text: string, replyTo?: string): Promise<{ command?: string; response?: string }> {
    const explicit = text.match(/^\s*(?:\/)?(approve|reject|批准|同意|拒绝|驳回)\s*(apv_[\w-]+)?\s*$/i);
    if (!explicit) return {};
    const approved = /^(approve|批准|同意)$/i.test(explicit[1]);
    let approvalId = explicit[2];
    if (!approvalId && replyTo) {
      const referenced = await this.repos.findNotificationEntityByExternalMessage('feishu', replyTo);
      if (referenced?.entity_type === 'approval') approvalId = referenced.entity_id;
    }
    if (!approvalId) {
      const pending = await this.repos.listPendingApprovals(10);
      if (pending.length === 1) approvalId = pending[0].id;
      else if (pending.length === 0) return { response: '当前没有等待你决定的审批。' };
      else return {
        response: [
          '当前有多个待审批事项，请回复“批准 apv_xxx”或“拒绝 apv_xxx”：',
          ...pending.map((item, index) => `${index + 1}. ${item.id}｜${item.task_title ?? item.action_type}`)
        ].join('\n')
      };
    }
    return { command: `/${approved ? 'approve' : 'reject'} ${approvalId}` };
  }
}

function renderApprovalPrompt(approval: {
  id: string;
  task_id: string | null;
  task_title: string | null;
  action_type: string;
  risk_level: string;
  prompt: string;
}) {
  return [
    '【数字本人暂停，等待你的决定】',
    `事项：${approval.task_title ?? '独立审批事项'}`,
    `审批 ID：${approval.id}`,
    `动作：${approval.action_type}`,
    `风险：${approval.risk_level}`,
    `原因：${approval.prompt}`,
    '',
    `直接回复：批准 ${approval.id}`,
    `或回复：拒绝 ${approval.id}`,
    '如果当前只有这一条待审批，也可以只回复“批准”或“拒绝”。批准后原任务会自动继续。'
  ].join('\n');
}

function attachmentKindLabel(kind: 'persona_source' | 'finance_sheet' | 'general_file' | 'image') {
  if (kind === 'persona_source') return '数字人格蒸馏资料';
  if (kind === 'finance_sheet') return '财务表格';
  if (kind === 'image') return '图片资料';
  return '公司通用资料';
}
