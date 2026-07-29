import type { AppConfig } from '../../config/index.js';
import type { Repositories } from '../../db/repositories.js';
import { logger } from '../../logger.js';
import { WechatIlinkClient } from './api-client.js';
import { WechatReplyDraftService } from './draft-service.js';
import { WechatIlinkStore } from './store.js';
import type { WechatAccountRecord, WechatMessage } from './types.js';
import { BullMqTaskDispatcher } from '../../queue/taskQueue.js';
import { decideApproval } from '../../approvals/decision.js';

export class WechatIlinkPoller {
  private readonly controllers = new Map<string, AbortController>();
  private readonly startedAccounts = new Set<string>();
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    private readonly store: WechatIlinkStore,
    private readonly client = new WechatIlinkClient(),
    private readonly drafts = new WechatReplyDraftService(config, repos),
    private readonly taskDispatcher = new BullMqTaskDispatcher(config.redis.url)
  ) {}

  async run() {
    this.stopping = false;
    while (!this.stopping) {
      const accounts = await this.store.listConnectedAccounts();
      if (!accounts.length) {
        await sleep(5000);
        continue;
      }
      await Promise.all(accounts.map((account) => this.pollAccount(account)));
    }
  }

  async stop() {
    this.stopping = true;
    for (const controller of this.controllers.values()) controller.abort();
    const accounts = await this.store.listConnectedAccounts().catch(() => []);
    await Promise.all(accounts.map(async (account) => {
      try { await this.client.notifyStop(account.base_url, this.store.decryptAccountToken(account)); } catch {}
    }));
    await this.taskDispatcher.close().catch(() => undefined);
  }

  private async pollAccount(account: WechatAccountRecord) {
    const controller = new AbortController();
    this.controllers.set(account.id, controller);
    try {
      const token = this.store.decryptAccountToken(account);
      if (!this.startedAccounts.has(account.id)) {
        await this.client.notifyStart(account.base_url, token);
        this.startedAccounts.add(account.id);
      }
      const cursor = await this.store.getCursor(account.id);
      const response = await this.client.getUpdates({
        baseUrl: account.base_url,
        token,
        cursor,
        signal: controller.signal
      });
      if (response.errcode === -14) {
        await this.store.setAccountHealth(account.id, { status: 'stale', error: 'session_timeout_-14' });
        return;
      }
      if (response.ret && response.ret !== 0) throw new Error(`wechat_getupdates_failed:${response.ret}:${response.errmsg ?? ''}`);
      for (const message of response.msgs ?? []) await this.handleMessage(account, message);
      if (typeof response.get_updates_buf === 'string') await this.store.saveCursor(account.id, response.get_updates_buf);
      await this.store.setAccountHealth(account.id, { status: 'connected', error: null });
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ accountId: account.id, error: message }, 'WeChat iLink polling failed');
        await this.store.setAccountHealth(account.id, { error: message }).catch(() => undefined);
        await sleep(this.config.wechatIlink.retryDelayMs);
      }
    } finally {
      this.controllers.delete(account.id);
    }
  }

  private async handleMessage(account: WechatAccountRecord, message: WechatMessage) {
    const peerId = message.from_user_id?.trim();
    if (!peerId || message.message_type === 2) return;
    const text = extractText(message);
    if (!text) return;
    const rawId = String(message.message_id ?? message.client_id ?? `${message.create_time_ms ?? Date.now()}`);
    const externalMessageId = `${account.id}:${rawId}`;
    if (message.context_token) await this.store.saveContextToken(account.id, peerId, message.context_token, externalMessageId);

    const owner = await this.repos.getPrimaryOwnerConversation(this.config.telegram.ownerIds);
    if (!owner) throw new Error('wechat_owner_mapping_not_found');
    const inbound = await this.repos.createChannelInboundMessage({
      channel: 'wechat',
      externalMessageId,
      externalChatId: peerId,
      externalUserId: peerId,
      userId: owner.userId,
      chatId: owner.chatId,
      text,
      raw: { accountId: account.id, message }
    });
    if (inbound.duplicate) return;

    if (await this.handleApprovalDecisionMessage(account, peerId, text, owner.chatId, owner.userId)) {
      await this.store.setAccountHealth(account.id, { messageReceived: true, error: null });
      return;
    }

    const task = await this.repos.createTask({
      title: `微信待回复：${text.slice(0, 60)}`,
      description: text,
      originMessageId: inbound.internalMessageId,
      ownerAgent: 'chief_of_staff',
      riskLevel: 'high',
      status: 'review',
      planningMetadata: { source: 'wechat_ilink', accountId: account.id, peerId, externalMessageId }
    });

    let draft: string | null = null;
    try { draft = await this.drafts.draft(text, peerId); } catch (error) {
      logger.error({ taskId: task.id, error: error instanceof Error ? error.message : String(error) }, 'WeChat reply draft failed');
    }
    if (!draft) {
      await this.repos.audit({ actorType: 'wechat', actorId: peerId, action: 'wechat_message_needs_manual_draft', entityType: 'task', entityId: task.id });
      return;
    }

    if (this.config.wechatIlink.replyMode === 'auto') {
      const contextToken = message.context_token ?? await this.store.getContextToken(account.id, peerId);
      if (!contextToken) {
        await this.repos.updateTaskStatus(task.id, 'review', '微信消息缺少 context_token，不能自动回复。');
        return;
      }
      try {
        const sent = await this.client.sendText({
          baseUrl: account.base_url,
          token: this.store.decryptAccountToken(account),
          to: peerId,
          contextToken,
          text: draft
        });
        await this.repos.createChannelOutboundMessage({
          channel: 'wechat',
          externalMessageId: `${account.id}:${sent.messageId}`,
          externalChatId: peerId,
          externalUserId: peerId,
          chatId: owner.chatId,
          text: draft,
          raw: { accountId: account.id, sourceMessageId: externalMessageId, automatic: true }
        });
        await this.repos.completeTask(task.id, `微信已自动回复：${draft}`);
        await this.repos.audit({
          actorType: 'system', action: 'wechat_auto_reply_sent', entityType: 'task', entityId: task.id,
          metadata: { accountId: account.id, peerId, messageId: sent.messageId }
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.repos.updateTaskStatus(task.id, 'failed', reason);
        await this.store.setAccountHealth(account.id, { error: reason });
        throw error;
      }
      await this.store.setAccountHealth(account.id, { messageReceived: true, error: null });
      return;
    }

    const approval = await this.repos.createApproval({
      taskId: task.id,
      actionType: 'wechat_send_message',
      riskLevel: 'high',
      prompt: `微信联系人 ${peerId} 发来：${text}\n\n数字本人拟回复：${draft}`,
      payload: { toolName: 'wechat_send_message', toolInput: { accountId: account.id, peerId, text: draft, sourceMessageId: externalMessageId } }
    });
    await this.repos.updateTaskStatus(task.id, 'waiting_approval', `等待批准微信回复：${approval.id}`);
    await this.store.setAccountHealth(account.id, { messageReceived: true, error: null });
  }

  private async handleApprovalDecisionMessage(
    account: WechatAccountRecord,
    peerId: string,
    text: string,
    chatId: string,
    ownerUserId: string
  ) {
    const parsed = parseApprovalDecision(text);
    if (!parsed) return false;

    if (!account.scanner_user_id || peerId !== account.scanner_user_id) {
      await this.repos.audit({
        actorType: 'wechat',
        actorId: peerId,
        action: 'wechat_approval_reply_ignored_non_owner',
        entityType: 'approval',
        metadata: { accountId: account.id, text }
      });
      return false;
    }

    let approvalId = parsed.approvalId;
    if (!approvalId) {
      const pending = await this.repos.listPendingApprovals(10);
      if (pending.length === 1) {
        approvalId = pending[0].id;
      } else if (pending.length === 0) {
        await this.sendControlReply(account, peerId, chatId, '当前没有等待你决定的审批。');
        return true;
      } else {
        await this.sendControlReply(account, peerId, chatId, [
          '当前有多个待审批事项，请回复“批准 apv_xxx”或“拒绝 apv_xxx”：',
          ...pending.map((item, index) => `${index + 1}. ${item.id}｜${item.task_title ?? item.action_type}`)
        ].join('\n'));
        return true;
      }
    }

    const result = await decideApproval({
      repos: this.repos,
      taskDispatcher: this.taskDispatcher,
      id: approvalId,
      status: parsed.status,
      userId: ownerUserId,
      actorType: 'wechat'
    });
    await this.sendControlReply(account, peerId, chatId, result);
    return true;
  }

  private async sendControlReply(
    account: WechatAccountRecord,
    peerId: string,
    chatId: string,
    text: string
  ) {
    const contextToken = await this.store.getContextToken(account.id, peerId);
    if (!contextToken) {
      await this.repos.audit({
        actorType: 'system',
        action: 'clawbot_control_reply_context_missing',
        metadata: { accountId: account.id, peerId }
      });
      return;
    }
    const sent = await this.client.sendText({
      baseUrl: account.base_url,
      token: this.store.decryptAccountToken(account),
      to: peerId,
      contextToken,
      text
    });
    await this.repos.createChannelOutboundMessage({
      channel: 'wechat',
      externalMessageId: `${account.id}:${sent.messageId}`,
      externalChatId: peerId,
      externalUserId: peerId,
      chatId,
      text,
      raw: { accountId: account.id, source: 'clawbot_approval_control_reply' }
    });
  }
}

function extractText(message: WechatMessage) {
  return (message.item_list ?? []).map((item) => item.text_item?.text ?? item.voice_item?.text ?? '').filter(Boolean).join('\n').trim();
}

function parseApprovalDecision(text: string) {
  const match = text.match(/^\s*(?:\/)?(approve|reject|批准|同意|拒绝|驳回)\s*(apv_[\w-]+)?\s*$/i);
  if (!match) return null;
  return {
    status: /^(approve|批准|同意)$/i.test(match[1]) ? 'approved' as const : 'rejected' as const,
    approvalId: match[2]
  };
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
