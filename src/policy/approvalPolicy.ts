import type { IntakeResult } from '../intake/intake.js';

export const financeApprovalActions = new Set([
  'payment',
  'refund',
  'transfer',
  'tax_filing',
  'billing_change',
  'financial_commitment',
  'cancel_subscription'
]);

export const operatorApprovalActions = new Set([
  'bulk_non_email_outreach',
  'paid_data_source',
  'ad_spend',
  'submit_external_form',
  'publish_content',
  'production_deploy',
  'delete_record',
  'destructive_command',
  'secret_change'
]);

export function isFinanceApprovalAction(action: string | undefined) {
  return Boolean(action && financeApprovalActions.has(action));
}

export function isOperatorApprovalAction(action: string | undefined) {
  return Boolean(action && operatorApprovalActions.has(action));
}

export function requiresApproval(intake: IntakeResult) {
  return isFinanceApprovalAction(intake.requiredApprovalAction) || isOperatorApprovalAction(intake.requiredApprovalAction);
}

export function approvalPromptFor(intake: IntakeResult) {
  const action = intake.requiredApprovalAction ?? 'guarded_action';
  const gate = isFinanceApprovalAction(action) ? 'Finance Gate' : 'Operator Gate';
  const reasons = intake.reasons.length ? intake.reasons.join('；') : '涉及真实资金、付费数据源、生产系统、外部表单或破坏性动作';
  return `V3 ${gate}：此动作需要你确认后才能执行。\n动作：${action}\n原因：${reasons}`;
}
