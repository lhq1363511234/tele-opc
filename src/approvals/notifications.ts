import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import type { ApprovalRecord, PendingApprovalRecord } from '../types.js';
import { FeishuClient } from '../feishu/client.js';
import { logger } from '../logger.js';
import { pool } from '../db/pool.js';
import { WechatIlinkClient } from '../channels/wechat-ilink/api-client.js';
import { WechatIlinkStore } from '../channels/wechat-ilink/store.js';

type ApprovalLike = Pick<ApprovalRecord, 'id' | 'task_id' | 'action_type' | 'risk_level' | 'prompt' | 'payload'>
  & Partial<Pick<PendingApprovalRecord, 'task_title'>>;

export function renderApprovalPrompt(approval: ApprovalLike) {
  if (approval.action_type === 'payment_received_confirmation') {
    const payload = (approval.payload ?? {}) as Record<string, unknown>;
    const title = textValue(payload.paymentTitle) || approval.task_title || '收款到账确认';
    const amount = [textValue(payload.amount), textValue(payload.currency)].filter(Boolean).join(' ');
    return [
      '【收款到账确认｜需要你审核】',
      `事项：${title}`,
      `审批 ID：${approval.id}`,
      amount ? `金额：${amount}` : '',
      textValue(payload.customerName) ? `客户：${textValue(payload.customerName)}` : '',
      textValue(payload.payerName) ? `付款人：${textValue(payload.payerName)}` : '',
      textValue(payload.payerContact) ? `联系方式：${textValue(payload.payerContact)}` : '',
      textValue(payload.payerNote) ? `付款备注：${textValue(payload.payerNote)}` : '',
      textValue(payload.paymentUrl) ? `收款页：${textValue(payload.paymentUrl)}` : '',
      '',
      '请先打开微信/银行/收款平台核对是否真的到账。',
      `到账回复：批准 ${approval.id}`,
      `没到账回复：拒绝 ${approval.id}`,
      '如果当前只有这一条待审批，也可以只回复“批准”或“拒绝”。'
    ].filter(Boolean).join('\n');
  }

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

export async function notifyApprovalChannels(config: AppConfig, repos: Repositories, approval: ApprovalRecord) {
  const [feishu, clawbot] = await Promise.allSettled([
    notifyApprovalToFeishu(config, repos, approval),
    notifyApprovalToClawBot(config, repos, approval)
  ]);
  return {
    feishu: feishu.status === 'fulfilled' ? feishu.value : { ok: false, error: String(feishu.reason) },
    clawbot: clawbot.status === 'fulfilled' ? clawbot.value : { ok: false, error: String(clawbot.reason) }
  };
}

async function notifyApprovalToFeishu(config: AppConfig, repos: Repositories, approval: ApprovalRecord) {
  if (!config.feishu.chatEnabled || !config.feishu.ownerOpenIds.length) {
    return { ok: false, skipped: true, reason: 'feishu_chat_disabled' };
  }

  const client = new FeishuClient(config.feishu.cliPath);
  const results: Array<Record<string, unknown>> = [];
  for (const recipientId of config.feishu.ownerOpenIds) {
    const reserved = await repos.reserveChannelNotification({
      channel: 'feishu',
      recipientId,
      entityType: 'approval',
      entityId: approval.id,
      metadata: { actionType: approval.action_type, source: 'approval_notifier' }
    });
    if (!reserved) {
      results.push({ recipientId, skipped: true, reason: 'already_notified' });
      continue;
    }
    try {
      const sent = await client.sendText({ userId: recipientId }, renderApprovalPrompt(approval));
      await repos.completeChannelNotification(reserved.id, sent.messageId);
      results.push({ recipientId, ok: true, messageId: sent.messageId });
    } catch (error) {
      await repos.deleteChannelNotification(reserved.id);
      logger.error({ approvalId: approval.id, recipientId, error }, 'approval feishu notification failed');
      results.push({ recipientId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { ok: results.some((item) => item.ok === true), results };
}

async function notifyApprovalToClawBot(config: AppConfig, repos: Repositories, approval: ApprovalRecord) {
  if (!config.wechatIlink.enabled) {
    return { ok: false, skipped: true, reason: 'clawbot_disabled' };
  }

  const store = new WechatIlinkStore(pool, config.app.encryptionKey);
  const accounts = await store.listConnectedAccounts();
  const account = accounts.find((item) => Boolean(item.scanner_user_id)) ?? accounts[0];
  if (!account) return { ok: false, skipped: true, reason: 'clawbot_account_not_connected' };

  const peerId = account.scanner_user_id;
  if (!peerId) return { ok: false, skipped: true, reason: 'clawbot_owner_peer_missing' };

  const reserved = await repos.reserveChannelNotification({
    channel: 'wechat',
    recipientId: peerId,
    entityType: 'approval',
    entityId: approval.id,
    metadata: {
      source: 'clawbot_approval_notifier',
      accountId: account.id,
      actionType: approval.action_type
    }
  });
  if (!reserved) return { ok: false, skipped: true, reason: 'already_notified' };

  try {
    const contextToken = await store.getContextToken(account.id, peerId);
    if (!contextToken) {
      await repos.deleteChannelNotification(reserved.id);
      return { ok: false, skipped: true, reason: 'clawbot_context_token_missing' };
    }

    const sent = await new WechatIlinkClient(config.wechatIlink.baseUrl).sendText({
      baseUrl: account.base_url,
      token: store.decryptAccountToken(account),
      to: peerId,
      contextToken,
      text: renderApprovalPrompt(approval),
      clientId: `tele-opc-approval-${approval.id}`
    });
    await repos.completeChannelNotification(reserved.id, `${account.id}:${sent.messageId}`);
    return { ok: true, accountId: account.id, peerId, messageId: sent.messageId };
  } catch (error) {
    await repos.deleteChannelNotification(reserved.id);
    logger.error({ approvalId: approval.id, accountId: account.id, peerId, error }, 'approval clawbot notification failed');
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function textValue(value: unknown) {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}
