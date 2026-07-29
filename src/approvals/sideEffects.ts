import type { ApprovalRecord } from '../types.js';
import type { Repositories } from '../db/repositories.js';

export type ApprovalSideEffectRepositories = Pick<
  Repositories,
  'confirmPaymentRequestPaid' | 'rejectPaymentRequestClaim'
>;

export async function applyApprovalSideEffects(
  repos: Partial<ApprovalSideEffectRepositories>,
  approval: ApprovalRecord,
  status: 'approved' | 'rejected',
  actorId?: string
) {
  if (approval.action_type !== 'payment_received_confirmation') return null;

  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const paymentRequestId = typeof payload.paymentRequestId === 'string' ? payload.paymentRequestId : '';
  if (!paymentRequestId) {
    return '收款确认审批缺少 paymentRequestId，未执行入账。';
  }
  if (!repos.confirmPaymentRequestPaid || !repos.rejectPaymentRequestClaim) {
    return '当前执行环境缺少收款入账能力，未执行入账。';
  }

  if (status === 'approved') {
    const confirmed = await repos.confirmPaymentRequestPaid(paymentRequestId, {
      confirmedBy: actorId ?? 'approval',
      note: `通过审批 ${approval.id} 确认到账`
    });
    if (!confirmed) return `没有找到收款单：${paymentRequestId}`;
    return [
      `收款审批 ${approval.id} 已批准。`,
      `已确认到账并入账：${confirmed.request.title}`,
      `金额：${confirmed.request.amount} ${confirmed.request.currency}`,
      `收入流水：${confirmed.transactionId}`
    ].join('\n');
  }

  const rejected = await repos.rejectPaymentRequestClaim(paymentRequestId, {
    rejectedBy: actorId ?? 'approval',
    note: `通过审批 ${approval.id} 拒绝到账确认`
  });
  if (!rejected) return `没有找到可退回的收款单：${paymentRequestId}`;
  return [
    `收款审批 ${approval.id} 已拒绝。`,
    `收款单已退回待付款/待核对：${rejected.title}`,
    '不会写入收入流水。'
  ].join('\n');
}
