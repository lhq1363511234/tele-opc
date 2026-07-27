import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import { AgentRunner } from '../ai/agentRunner.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { isOwnerAllowed } from '../auth/ownerAllowlist.js';
import type { Repositories } from '../db/repositories.js';
import { ChiefOfStaff } from '../brain/chiefOfStaff.js';
import { CodexBridge, parseCodexBridgeCommand } from '../codex/codexBridge.js';
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from './types.js';
import { TelegramClient } from './client.js';
import { logger } from '../logger.js';
import { BullMqTaskDispatcher, type TaskDispatcher } from '../queue/taskQueue.js';
import {
  buildApprovalCard,
  buildApprovalListCard,
  buildAttachmentCard,
  buildHelpCard,
  buildMiniAppPanelCard,
  buildNewTaskMenu,
  buildTaskDetailCard,
  buildTaskListCard,
  classifyAttachment,
  commandArg,
  firstCommand,
  parseTelegramCallbackData,
  resolveApprovalReference,
  resolveTaskReference,
  shouldHandleAsTelegramTaskCommand
} from './ux.js';

export class TelegramUpdateHandler {
  private readonly brain: ChiefOfStaff;
  private readonly client: TelegramClient;
  private readonly codexBridge: CodexBridge;

  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    taskDispatcher: TaskDispatcher = new BullMqTaskDispatcher(config.redis.url)
  ) {
    const modelProvider = createModelProviderFromConfig(config);
    const agentRunner = modelProvider ? new AgentRunner(modelProvider, repos) : null;
    this.brain = new ChiefOfStaff(
      repos,
      taskDispatcher,
      undefined,
      undefined,
      undefined,
      undefined,
      agentRunner
    );
    this.client = new TelegramClient(config.telegram.botToken);
    this.codexBridge = new CodexBridge(config.codexBridge);
  }

  async handle(update: TelegramUpdate) {
    try {
      await this.handleAcceptedUpdate(update);
    } catch (error) {
      const message = update.message ?? update.edited_message;
      logger.error(
        {
          updateId: update.update_id,
          telegramUserId: message?.from?.id,
          telegramChatId: message?.chat.id,
          error: error instanceof Error ? error.message : String(error)
        },
        'telegram update processing failed'
      );

      // The webhook already returned HTTP 200. Without an explicit reply, a
      // model timeout or database failure looks exactly like being ignored.
      if (message?.from && isOwnerAllowed(message.from, this.config.telegram.ownerIds)) {
        await this.client.sendMessage(
          message.chat.id,
          '任务已收到，但理解或执行入口刚刚失败了。系统已记录错误，请稍后重试；这不是你表达有问题。'
        ).catch((notifyError) => {
          logger.error(
            { updateId: update.update_id, error: notifyError instanceof Error ? notifyError.message : String(notifyError) },
            'telegram failure notification failed'
          );
        });
      }
      throw error;
    }
  }

  private async handleAcceptedUpdate(update: TelegramUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query, update.update_id);
      return;
    }

    const message = update.message ?? update.edited_message;
    if (!message) {
      logger.info({ updateId: update.update_id }, 'telegram update ignored: no message');
      return;
    }

    if (!isOwnerAllowed(message.from, this.config.telegram.ownerIds)) {
      await this.repos.audit({
        actorType: 'telegram',
        actorId: message.from?.id.toString(),
        action: 'telegram_unauthorized_message',
        metadata: { update }
      });
      logger.warn({ from: message.from?.id }, 'unauthorized telegram user');
      return;
    }

    const user = await this.repos.upsertUserFromTelegram(message.from!);
    const chat = await this.repos.upsertChatFromTelegram(message.chat);
    const inbound = await this.repos.createInboundMessage({
      message,
      userId: user.id,
      chatId: chat.id
    });
    logger.info(
      {
        updateId: update.update_id,
        inboundMessageId: inbound.id,
        telegramMessageId: message.message_id,
        telegramUserId: message.from!.id,
        telegramChatId: message.chat.id,
        textPreview: (message.text ?? message.caption ?? '').slice(0, 120)
      },
      'telegram inbound message persisted'
    );

    const uxHandled = await this.handleTelegramUxMessage(message, {
      telegramUserId: message.from!.id,
      userId: user.id,
      chatId: chat.id,
      originMessageId: inbound.id
    });
    if (uxHandled) return;

    await this.client.sendChatAction(message.chat.id, 'typing');
    const bridgeCommand = parseCodexBridgeCommand(message.text);
    const shouldAcknowledge = !bridgeCommand && Boolean(message.text?.trim()) && !message.text!.trim().startsWith('/');
    if (shouldAcknowledge) {
      const acknowledgement = '收到。我正在理解你的目标、检查上下文并决定下一步。';
      await this.repos.createOutboundMessage({
        chatId: chat.id,
        text: acknowledgement,
        raw: { replyToUpdateId: update.update_id, source: 'telegram_intake_ack' }
      });
      await this.client.sendMessage(message.chat.id, acknowledgement);
    }
    const reply = bridgeCommand
      ? await this.codexBridge.handle(bridgeCommand, {
          telegramUserId: message.from!.id,
          chatId: chat.id,
          messageId: inbound.id
        })
      : await this.brain.handleText(message.text, {
          telegramUserId: message.from!.id,
          userId: user.id,
          chatId: chat.id,
          originMessageId: inbound.id
        });

    const taskFromReply = await this.taskCardFromReply(reply);
    if (taskFromReply) {
      await this.repos.createOutboundMessage({
        chatId: chat.id,
        text: taskFromReply.text,
        raw: { replyToUpdateId: update.update_id, source: 'telegram_task_card_from_reply' }
      });
      await this.client.sendMessage(message.chat.id, taskFromReply.text, { replyMarkup: taskFromReply.replyMarkup });
      return;
    }

    await this.repos.createOutboundMessage({
      chatId: chat.id,
      text: reply,
      raw: { replyToUpdateId: update.update_id }
    });
    await this.client.sendMessage(message.chat.id, reply);
  }

  private async handleCallbackQuery(callbackQuery: TelegramCallbackQuery, updateId: number) {
    if (!isOwnerAllowed(callbackQuery.from, this.config.telegram.ownerIds)) {
      await this.repos.audit({
        actorType: 'telegram',
        actorId: callbackQuery.from.id.toString(),
        action: 'telegram_unauthorized_callback',
        metadata: { updateId, callbackQueryId: callbackQuery.id }
      });
      logger.warn({ from: callbackQuery.from.id }, 'unauthorized telegram callback');
      await this.client.answerCallbackQuery(callbackQuery.id, '没有权限', true);
      return;
    }

    const action = parseTelegramCallbackData(callbackQuery.data);
    if (!action) {
      await this.client.answerCallbackQuery(callbackQuery.id, '这个按钮已经失效，请重新打开任务列表。', true);
      return;
    }

    const user = await this.repos.upsertUserFromTelegram(callbackQuery.from);
    const chat = callbackQuery.message ? await this.repos.upsertChatFromTelegram(callbackQuery.message.chat) : null;
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;

    try {
      if (action.kind === 'nav') {
        await this.client.answerCallbackQuery(callbackQuery.id);
        if (action.action === 'tasks') {
          const tasks = await this.repos.listTopLevelTasks(30);
          await this.upsertCallbackMessage(chatId, messageId, buildTaskListCard(tasks, this.config));
          return;
        }
        if (action.action === 'approvals') {
          const approvals = await this.repos.listPendingApprovals(20);
          await this.upsertCallbackMessage(chatId, messageId, buildApprovalListCard(approvals, this.config));
          return;
        }
        await this.upsertCallbackMessage(chatId, messageId, buildNewTaskMenu(this.config));
        return;
      }

      if (action.kind === 'new') {
        await this.client.answerCallbackQuery(callbackQuery.id, '已打开 Telegram 原生配置入口');
        await this.upsertCallbackMessage(chatId, messageId, buildMiniAppPanelCard(action.action, this.config));
        return;
      }

      if (action.kind === 'quick_new') {
        await this.handleQuickNewCallback(action.action, callbackQuery.id, user.id, chat?.id, chatId, messageId);
        return;
      }

      if (action.kind === 'task') {
        await this.handleTaskCallback(action, callbackQuery.id, user.id, chat?.id, chatId, messageId);
        return;
      }

      if (action.kind === 'approval') {
        await this.handleApprovalCallback(action, callbackQuery.id, user.id, chat?.id, chatId, messageId);
      }
    } catch (error) {
      logger.error({ error, callbackQueryId: callbackQuery.id }, 'telegram callback handling failed');
      await this.client.answerCallbackQuery(callbackQuery.id, '处理失败，请稍后重试。', true);
    }
  }

  private async handleTelegramUxMessage(message: TelegramMessage, context: {
    telegramUserId: number;
    userId: string;
    chatId: string;
    originMessageId: string;
  }) {
    if (message.web_app_data) {
      const task = await this.repos.createTask({
        title: `Mini App 提交：${message.web_app_data.button_text}`,
        description: message.web_app_data.data,
        originMessageId: context.originMessageId,
        ownerAgent: 'chief_of_staff',
        status: 'planned',
        planningMetadata: {
          source: 'telegram_web_app',
          buttonText: message.web_app_data.button_text
        }
      });
      await this.repos.createOutboundMessage({
        chatId: context.chatId,
        text: `已收到 Mini App 配置：${task.id}`,
        raw: { source: 'telegram_ux', taskId: task.id }
      });
      await this.client.sendMessage(
        message.chat.id,
        buildTaskDetailCard(task, [], this.config, ['来源：Telegram Mini App']).text,
        { replyMarkup: buildTaskDetailCard(task, [], this.config).replyMarkup }
      );
      return true;
    }

    if (message.document || message.photo?.length || message.voice) {
      const storedFile = await this.storeTelegramAttachment(message);
      const attachmentKind = classifyAttachment(message);
      const task = await this.repos.createTask({
        title: attachmentTaskTitle(message),
        description: attachmentTaskDescription(message),
        originMessageId: context.originMessageId,
        ownerAgent: attachmentOwnerAgent(attachmentKind),
        status: 'planned',
        planningMetadata: {
          source: 'telegram_attachment',
          attachmentKind,
          telegramMessageId: message.message_id,
          storedFile
        }
      });
      const artifact = await this.repos.createArtifact({
        taskId: task.id,
        type: `telegram_${classifyAttachment(message)}`,
        title: message.document?.file_name ?? message.caption ?? 'Telegram 附件',
        uri: storedFile?.artifactPath ?? attachmentUri(message) ?? undefined,
        content: message.caption ?? undefined,
        metadata: {
          telegramMessageId: message.message_id,
          document: message.document,
          photo: message.photo,
          voice: message.voice,
          storedFile
        }
      });
      await this.repos.audit({
        actorType: 'telegram',
        actorId: message.from?.id.toString(),
        action: 'telegram_attachment_received',
        entityType: 'task',
        entityId: task.id,
        metadata: {
          artifactId: artifact.id,
          attachmentKind,
          storedFile
        }
      });
      const card = buildAttachmentCard(message, this.config, artifact.id, task);
      await this.repos.createOutboundMessage({
        chatId: context.chatId,
        text: card.text,
        raw: { source: 'telegram_ux', artifactId: artifact.id, taskId: task.id }
      });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (!shouldHandleAsTelegramTaskCommand(message.text)) return false;

    const command = firstCommand(message.text);
    const arg = commandArg(message.text);
    if (command === '/help') {
      const card = buildHelpCard(this.config);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/start') {
      if (/^task[_-]/i.test(arg)) {
        const taskRef = arg.replace(/^task[_-]/i, '');
        const task = await resolveTaskReference(this.repos, taskRef);
        const card = task
          ? buildTaskDetailCard(task, await this.repos.listSubtasks(task.id), this.config)
          : buildTaskListCard(await this.repos.listTopLevelTasks(30), this.config);
        await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_deep_link' } });
        await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
        return true;
      }
      if (/^approval/i.test(arg)) {
        const card = buildApprovalListCard(await this.repos.listPendingApprovals(20), this.config);
        await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_deep_link' } });
        await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
        return true;
      }
      const card = buildNewTaskMenu(this.config);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_deep_link' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/tasks') {
      const tasks = await this.repos.listTopLevelTasks(30);
      const card = buildTaskListCard(tasks, this.config);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/next') {
      const tasks = await this.repos.listTasksByStatuses(['blocked', 'waiting_external', 'planned', 'failed', 'waiting_approval', 'running', 'queued'], 1);
      const card = tasks[0]
        ? buildTaskDetailCard(tasks[0], await this.repos.listSubtasks(tasks[0].id), this.config)
        : buildTaskListCard([], this.config, '下一步');
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/new') {
      const card = buildNewTaskMenu(this.config);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/approvals') {
      const approvals = await this.repos.listPendingApprovals(20);
      const card = buildApprovalListCard(approvals, this.config);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/task') {
      const task = await resolveTaskReference(this.repos, arg);
      const card = task
        ? buildTaskDetailCard(task, await this.repos.listSubtasks(task.id), this.config)
        : { text: '没有找到这个任务。请发送 /tasks 查看当前任务。', replyMarkup: buildTaskListCard(await this.repos.listTopLevelTasks(20), this.config).replyMarkup };
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/retry') {
      const task = await resolveTaskReference(this.repos, arg);
      if (!task) {
        await this.client.sendMessage(message.chat.id, '没有找到这个任务。请发送 /tasks 查看当前任务。');
        return true;
      }
      const reply = await this.brain.handleText(`/retry ${task.id}`, context);
      const updatedTask = await this.repos.getTask(task.id) ?? task;
      const card = buildTaskDetailCard(updatedTask, await this.repos.listSubtasks(updatedTask.id), this.config, [reply]);
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    if (command === '/approve' || command === '/reject') {
      const approval = await resolveApprovalReference(this.repos, arg);
      if (!approval) {
        await this.client.sendMessage(message.chat.id, '没有找到这个审批。请发送 /approvals 查看待审批事项。');
        return true;
      }
      const reply = await this.brain.handleText(`${command} ${approval.id}`, context);
      const card = approval.task_id
        ? buildTaskDetailCard(
            await this.repos.getTask(approval.task_id) ?? await this.placeholderTask(approval.task_id),
            approval.task_id ? await this.repos.listSubtasks(approval.task_id) : [],
            this.config,
            [reply]
          )
        : { text: reply, replyMarkup: buildApprovalListCard(await this.repos.listPendingApprovals(20), this.config).replyMarkup };
      await this.repos.createOutboundMessage({ chatId: context.chatId, text: card.text, raw: { source: 'telegram_ux' } });
      await this.client.sendMessage(message.chat.id, card.text, { replyMarkup: card.replyMarkup });
      return true;
    }

    return false;
  }

  private async handleTaskCallback(
    action: { kind: 'task'; action: 'view' | 'retry' | 'continue' | 'pause' | 'cancel'; id: string },
    callbackQueryId: string,
    userId: string,
    appChatId?: string,
    telegramChatId?: number,
    messageId?: number
  ) {
    const task = await this.repos.getTask(action.id);
    if (!task) {
      await this.client.answerCallbackQuery(callbackQueryId, '任务不存在或已删除。', true);
      return;
    }

    let extraLines: string[] = [];
    if (action.action === 'retry' || action.action === 'continue') {
      extraLines = [await this.brain.handleText(`/retry ${task.id}`, {
        telegramUserId: 0,
        userId,
        chatId: appChatId ?? '',
        originMessageId: undefined
      })];
    } else if (action.action === 'pause') {
      await this.repos.updateTaskStatus(task.id, 'blocked', 'Paused by Telegram owner');
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'task_paused',
        entityType: 'task',
        entityId: task.id
      });
      extraLines = ['已暂停：任务进入已阻塞状态，可点继续执行重新推进。'];
    } else if (action.action === 'cancel') {
      await this.repos.updateTaskStatus(task.id, 'cancelled', 'Cancelled by Telegram owner');
      await this.repos.audit({
        actorType: 'user',
        actorId: userId,
        action: 'task_cancelled',
        entityType: 'task',
        entityId: task.id
      });
      extraLines = ['已取消：任务不会继续执行。'];
    }

    const updatedTask = await this.repos.getTask(task.id) ?? task;
    const card = buildTaskDetailCard(updatedTask, await this.repos.listSubtasks(updatedTask.id), this.config, extraLines);
    await this.client.answerCallbackQuery(callbackQueryId, '已更新');
    await this.upsertCallbackMessage(telegramChatId, messageId, card);
  }

  private async handleQuickNewCallback(
    action: 'ppt' | 'crm' | 'mail' | 'finance' | 'agent',
    callbackQueryId: string,
    userId: string,
    appChatId?: string,
    telegramChatId?: number,
    messageId?: number
  ) {
    if (action === 'ppt') {
      await this.client.answerCallbackQuery(callbackQueryId, '请打开 PPT 引导，先确认主题');
      await this.upsertCallbackMessage(telegramChatId, messageId, buildMiniAppPanelCard('ppt', this.config));
      return;
    }

    await this.client.answerCallbackQuery(callbackQueryId, '正在创建 v0 任务');
    const reply = await this.brain.handleText(quickNewPrompt(action), {
      telegramUserId: 0,
      userId,
      chatId: appChatId ?? '',
      originMessageId: undefined
    });
    const card = await this.taskCardFromReply(reply) ?? {
      text: reply,
      replyMarkup: buildNewTaskMenu(this.config).replyMarkup
    };
    await this.upsertCallbackMessage(telegramChatId, messageId, card);
  }

  private async handleApprovalCallback(
    action: { kind: 'approval'; action: 'approve' | 'reject' | 'view'; id: string },
    callbackQueryId: string,
    userId: string,
    appChatId?: string,
    telegramChatId?: number,
    messageId?: number
  ) {
    const approval = await this.repos.getApproval(action.id);
    if (!approval) {
      await this.client.answerCallbackQuery(callbackQueryId, '审批不存在或已处理。', true);
      return;
    }

    if (action.action === 'view') {
      await this.client.answerCallbackQuery(callbackQueryId);
      await this.upsertCallbackMessage(telegramChatId, messageId, buildApprovalCard(approval, this.config));
      return;
    }

    const command = action.action === 'approve' ? '/approve' : '/reject';
    const reply = await this.brain.handleText(`${command} ${approval.id}`, {
      telegramUserId: 0,
      userId,
      chatId: appChatId ?? '',
      originMessageId: undefined
    });
    await this.client.answerCallbackQuery(callbackQueryId, action.action === 'approve' ? '已批准' : '已拒绝');

    if (approval.task_id) {
      const task = await this.repos.getTask(approval.task_id);
      if (task) {
        await this.upsertCallbackMessage(
          telegramChatId,
          messageId,
          buildTaskDetailCard(task, await this.repos.listSubtasks(task.id), this.config, [reply])
        );
        return;
      }
    }

    await this.upsertCallbackMessage(telegramChatId, messageId, {
      text: reply,
      replyMarkup: buildApprovalListCard(await this.repos.listPendingApprovals(20), this.config).replyMarkup
    });
  }

  private async upsertCallbackMessage(chatId: number | undefined, messageId: number | undefined, card: { text: string; replyMarkup?: any }) {
    if (chatId && messageId) {
      await this.client.editMessageText(chatId, messageId, card.text, { replyMarkup: card.replyMarkup });
      return;
    }
    if (chatId) {
      await this.client.sendMessage(chatId, card.text, { replyMarkup: card.replyMarkup });
    }
  }

  private async taskCardFromReply(reply: string) {
    const taskId = extractTaskId(reply);
    if (!taskId) return null;
    const task = await this.repos.getTask(taskId);
    if (!task) return null;
    const displayTask = task.parent_task_id ? await this.repos.getTask(task.parent_task_id) ?? task : task;
    const subtasks = await this.repos.listSubtasks(displayTask.id);
    const summary = summarizeChiefReply(reply);
    return buildTaskDetailCard(displayTask, subtasks, this.config, summary ? [summary] : []);
  }

  private async storeTelegramAttachment(message: TelegramMessage) {
    const fileId = message.document?.file_id
      ?? message.voice?.file_id
      ?? message.photo?.[message.photo.length - 1]?.file_id;
    if (!fileId) return null;

    try {
      const downloaded = await this.client.downloadFile(fileId);
      if (!downloaded) return null;

      const date = new Date().toISOString().slice(0, 10);
      const dir = path.resolve(process.cwd(), 'runtime', 'artifacts', 'telegram', date);
      await mkdir(dir, { recursive: true });
      const name = safeFileName(message.document?.file_name ?? downloaded.file.file_path?.split('/').pop() ?? `${fileId}.bin`);
      const artifactPath = path.join(dir, `${fileId}_${name}`);
      await writeFile(artifactPath, downloaded.bytes);
      return {
        artifactPath,
        file: downloaded.file,
        byteLength: downloaded.bytes.byteLength
      };
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error), fileId }, 'failed to store telegram attachment');
      return null;
    }
  }

  private async placeholderTask(taskId: string) {
    return {
      id: taskId,
      title: '关联任务',
      description: null,
      origin_message_id: null,
      parent_task_id: null,
      owner_agent: 'chief_of_staff',
      priority: 'normal',
      risk_level: 'low',
      status: 'planned',
      sequence: null,
      planning_metadata: {},
      result: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as const;
  }
}

function attachmentUri(message: TelegramMessage) {
  const fileId = message.document?.file_id
    ?? message.voice?.file_id
    ?? message.photo?.[message.photo.length - 1]?.file_id
    ?? '';
  return fileId ? `telegram:file:${fileId}` : null;
}

function extractTaskId(text: string) {
  return text.match(/tsk_[a-z0-9-]+/i)?.[0] ?? null;
}

function summarizeChiefReply(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^发送\s+/.test(line))
    .slice(0, 5);
  return lines.length ? `任务说明：${lines.join(' / ').slice(0, 420)}` : '';
}

function quickNewPrompt(action: 'ppt' | 'crm' | 'mail' | 'finance' | 'agent') {
  const prompts = {
    ppt: [
      '打开 PPT 引导生成入口。',
      '当前用户是从 Telegram 手机端功能按钮进入，请先引导用户补充主题、受众、用途、页数、风格和素材。',
      '不要创建空壳 PPT v0 任务；拿到主题后再进入内容工作流并生成可预览幻灯片。'
    ],
    crm: [
      '创建一个 CRM/客户挖掘 v0 任务。',
      '当前用户是从 Telegram 手机端功能按钮进入，没有上传表格或细节。',
      '请先给出线索导入模板、客户画像字段、评分规则、下一步需要用户补充的最少信息。',
      '如果可以自动推进，就创建任务和子任务；不要停在空问题上。'
    ],
    mail: [
      '创建一个邮件编辑 v0 任务。',
      '当前用户是从 Telegram 手机端功能按钮进入，没有填写收件人和上下文。',
      '请先生成邮件草稿任务模板：目标、受众、语气、待补充信息、发送前检查项。',
      '邮件发送本身不需要审批，但报价、付款、对外承诺必须提醒并走审批。'
    ],
    finance: [
      '创建一个财务检查 v0 任务。',
      '当前用户是从 Telegram 手机端功能按钮进入。',
      '请汇总待审批事项、近期财务风险和下一步建议。',
      '不要执行付款、退款、转账或账单变更；这些必须等待 Owner 审批。'
    ],
    agent: [
      '创建一个 Agent 设置检查 v0 任务。',
      '当前用户是从 Telegram 手机端功能按钮进入，没有填写详细配置。',
      '请检查当前 Agent OS 应该具备的 Provider、权限边界、Skill 编排、知识库导入和 Telegram 交互体验。',
      '不要修改密钥或生产部署；如需敏感配置，只生成待办和说明。'
    ]
  } satisfies Record<typeof action, string[]>;
  return prompts[action].join('\n');
}

function attachmentTaskTitle(message: TelegramMessage) {
  const name = message.document?.file_name ?? message.caption ?? '';
  if (message.voice) return '语音转任务';
  if (message.photo?.length) return `分析图片/截图${name ? `：${name}` : ''}`;
  if (/\.(csv|xlsx?|ods)$/i.test(name)) return `导入表格：${name}`;
  if (name) return `导入知识库资料：${name}`;
  return '处理 Telegram 附件';
}

function attachmentTaskDescription(message: TelegramMessage) {
  if (message.voice) return 'Telegram 收到语音。下一步由 Agent 转写并拆成可执行任务。';
  if (message.photo?.length) return 'Telegram 收到图片/截图。下一步由 Browser/QA Agent 做视觉分析或作为任务证据。';
  if (message.document?.file_name && /\.(csv|xlsx?|ods)$/i.test(message.document.file_name)) {
    return 'Telegram 收到表格文件。下一步可导入 CRM 线索或财务数据。';
  }
  return 'Telegram 收到文件。下一步可导入知识库或作为任务资料。';
}

function attachmentOwnerAgent(kind: ReturnType<typeof classifyAttachment>) {
  if (kind === 'spreadsheet') return 'crm';
  if (kind === 'image') return 'browser';
  if (kind === 'voice') return 'chief_of_staff';
  return 'knowledge_base';
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 140) || 'telegram-file.bin';
}
