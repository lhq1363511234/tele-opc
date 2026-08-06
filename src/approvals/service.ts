import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import type { TaskDispatcher } from '../queue/taskQueue.js';
import type { ApprovalRecord, ApprovalStatus, RiskLevel } from '../types.js';
import { decideApproval } from './decision.js';
import { notifyApprovalChannels } from './notifications.js';

export interface ApprovalRequest {
  taskId?: string;
  actionType: string;
  riskLevel?: RiskLevel;
  prompt: string;
  payload?: Record<string, unknown>;
  actorType?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Single entry point for the complete approval lifecycle.
 *
 * Channels and business modules must not create/decide approvals directly:
 * request() persists + audits + notifies; decide() applies the shared state
 * transition, side effects and task resume/block behavior.
 */
export class ApprovalService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    private readonly taskDispatcher?: TaskDispatcher
  ) {}

  async request(params: ApprovalRequest) {
    const approval = await this.repos.createApproval({
      taskId: params.taskId,
      actionType: params.actionType,
      riskLevel: params.riskLevel ?? 'high',
      prompt: params.prompt,
      payload: params.payload
    });

    await this.repos.audit({
      actorType: params.actorType ?? 'system',
      actorId: params.actorId,
      action: 'approval_requested',
      entityType: 'approval',
      entityId: approval.id,
      metadata: {
        taskId: approval.task_id,
        actionType: approval.action_type,
        riskLevel: approval.risk_level,
        ...(params.metadata ?? {})
      }
    });

    const notifications = await this.notify(approval);
    return { approval, notifications };
  }

  async notify(approval: ApprovalRecord) {
    const notifications = await notifyApprovalChannels(this.config, this.repos, approval);
    await this.repos.audit({
      actorType: 'system',
      action: 'approval_notifications_dispatched',
      entityType: 'approval',
      entityId: approval.id,
      metadata: notificationSummary(notifications)
    });
    return notifications;
  }

  async decide(params: {
    id: string;
    status: Extract<ApprovalStatus, 'approved' | 'rejected'>;
    userId: string;
    actorType?: string;
  }) {
    return decideApproval({
      repos: this.repos,
      taskDispatcher: this.taskDispatcher,
      ...params
    });
  }
}

function notificationSummary(notifications: Awaited<ReturnType<typeof notifyApprovalChannels>>) {
  return {
    feishu: summarizeChannel(notifications.feishu),
    clawbot: summarizeChannel(notifications.clawbot),
    telegram: summarizeChannel(notifications.telegram)
  };
}

function summarizeChannel(result: Record<string, unknown>) {
  return {
    ok: result.ok === true,
    skipped: result.skipped === true,
    reason: typeof result.reason === 'string' ? result.reason : undefined,
    error: typeof result.error === 'string' ? result.error : undefined
  };
}
