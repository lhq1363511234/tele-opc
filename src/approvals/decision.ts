import type { Repositories } from '../db/repositories.js';
import type { ApprovalStatus } from '../types.js';
import type { TaskDispatcher, TaskJobData } from '../queue/taskQueue.js';
import { applyApprovalSideEffects } from './sideEffects.js';

export type ApprovalDecisionRepositories = Pick<
  Repositories,
  | 'audit'
  | 'updateApprovalStatus'
  | 'updateTaskStatus'
> & Partial<Pick<
  Repositories,
  | 'confirmPaymentRequestPaid'
  | 'getApproval'
  | 'rejectPaymentRequestClaim'
>>;

export async function decideApproval(params: {
  repos: ApprovalDecisionRepositories;
  taskDispatcher?: TaskDispatcher;
  id: string;
  status: Extract<ApprovalStatus, 'approved' | 'rejected'>;
  userId: string;
  actorType?: string;
}) {
  if (params.repos.getApproval) {
    const existing = await params.repos.getApproval(params.id);
    if (!existing) return `没有找到审批：${params.id}`;
    if (existing.status !== 'pending') {
      return `审批 ${params.id} 已经是 ${statusLabel(existing.status)}，不会重复执行。`;
    }
  }

  const approval = await params.repos.updateApprovalStatus(params.id, params.status, params.userId);
  if (!approval) return `没有找到审批：${params.id}`;

  await params.repos.audit({
    actorType: params.actorType ?? 'user',
    actorId: params.userId,
    action: `approval_${params.status}`,
    entityType: 'approval',
    entityId: params.id
  });

  const sideEffect = await applyApprovalSideEffects(params.repos, approval, params.status, params.userId);
  if (sideEffect) return sideEffect;

  if (!approval.task_id) {
    return `审批 ${params.id} 已${params.status === 'approved' ? '批准' : '拒绝'}。`;
  }

  if (params.status === 'approved') {
    const enqueueResult = await enqueueApprovedTask(params.repos, params.taskDispatcher, approval.task_id, {
      taskId: approval.task_id,
      source: 'approval',
      approvalId: approval.id,
      actionType: approval.action_type
    });

    return [
      `审批 ${params.id} 已批准。`,
      enqueueResult.queued
        ? `关联任务已进入队列${enqueueResult.jobId ? `：${enqueueResult.jobId}` : '。'}`
        : '关联任务已批准，但队列暂时不可用；任务已保留为 planned，稍后可重试。'
    ].join('\n');
  }

  await params.repos.updateTaskStatus(approval.task_id, 'blocked', 'Approval rejected');
  return `审批 ${params.id} 已拒绝。关联任务已阻塞。`;
}

async function enqueueApprovedTask(
  repos: Pick<Repositories, 'audit' | 'updateTaskStatus'>,
  taskDispatcher: TaskDispatcher | undefined,
  taskId: string,
  data: TaskJobData
) {
  if (!taskDispatcher) {
    await repos.updateTaskStatus(taskId, 'planned', 'Approved; queue dispatcher unavailable');
    await repos.audit({
      actorType: 'system',
      action: 'task_enqueue_unavailable',
      entityType: 'task',
      entityId: taskId,
      metadata: { ...data }
    });
    return { queued: false, jobId: undefined as string | number | undefined };
  }

  try {
    const enqueued = await taskDispatcher.enqueueTask(data);
    await repos.updateTaskStatus(
      taskId,
      'queued',
      enqueued.jobId ? `Queued as job ${enqueued.jobId}` : 'Queued for worker'
    );
    await repos.audit({
      actorType: 'system',
      action: 'task_enqueued',
      entityType: 'task',
      entityId: taskId,
      metadata: {
        ...data,
        jobId: enqueued.jobId
      }
    });
    return { queued: true, jobId: enqueued.jobId };
  } catch (error) {
    await repos.updateTaskStatus(taskId, 'planned', 'Queue unavailable; task saved for retry');
    await repos.audit({
      actorType: 'system',
      action: 'task_enqueue_failed',
      entityType: 'task',
      entityId: taskId,
      metadata: {
        ...data,
        error: error instanceof Error ? error.message : 'unknown error'
      }
    });
    return { queued: false, jobId: undefined as string | number | undefined };
  }
}

function statusLabel(status: ApprovalStatus) {
  if (status === 'approved') return '已批准';
  if (status === 'rejected') return '已拒绝';
  if (status === 'expired') return '已过期';
  return '待审批';
}
