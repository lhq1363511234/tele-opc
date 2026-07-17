import type { RiskLevel } from '../types.js';

export type IntakeKind = 'command' | 'task' | 'question' | 'empty';

export interface IntakeResult {
  kind: IntakeKind;
  normalizedText: string;
  title: string;
  riskLevel: RiskLevel;
  requiredApprovalAction?: string;
  reasons: string[];
}

const highRiskRules: Array<{ action: string; pattern: RegExp; reason: string }> = [
  { action: 'payment', pattern: /付款|支付|转账|退款|扣款|收款/i, reason: '涉及资金动作' },
  { action: 'cancel_subscription', pattern: /取消订阅|退订|停止续费/i, reason: '涉及订阅变更' },
  { action: 'bulk_non_email_outreach', pattern: /批量.*(短信|私信|电话|外联)|群发短信|群发私信|电话群呼/i, reason: '涉及非邮件批量外部触达' },
  { action: 'paid_data_source', pattern: /购买.*(线索|名单|数据)|付费数据源|开通.*(Apollo|Clay|数据库)/i, reason: '涉及购买或开通付费数据源' },
  { action: 'ad_spend', pattern: /投放广告|广告预算|充值广告|推广预算/i, reason: '涉及付费获客预算' },
  { action: 'submit_external_form', pattern: /提交.*表单|提交网页|保存设置|确认下单/i, reason: '涉及外部网页提交' },
  { action: 'publish_content', pattern: /发布到|发到|推送到|公开发布/i, reason: '涉及公开发布' },
  { action: 'production_deploy', pattern: /部署|生产环境|上线代码/i, reason: '涉及生产系统' },
  { action: 'delete_record', pattern: /删除|清空|移除/i, reason: '涉及删除动作' }
];

export function intakeMessage(text: string | undefined): IntakeResult {
  const normalizedText = (text ?? '').trim();
  if (!normalizedText) {
    return {
      kind: 'empty',
      normalizedText,
      title: '空消息',
      riskLevel: 'low',
      reasons: ['未收到文本内容']
    };
  }

  if (normalizedText.startsWith('/')) {
    return {
      kind: 'command',
      normalizedText,
      title: normalizedText,
      riskLevel: 'low',
      reasons: ['Telegram command']
    };
  }

  const reasons: string[] = [];
  let requiredApprovalAction: string | undefined;
  for (const rule of highRiskRules) {
    if (rule.pattern.test(normalizedText)) {
      reasons.push(rule.reason);
      requiredApprovalAction ??= rule.action;
    }
  }

  const taskPattern = /帮我|准备|创建|整理|分析|评估|查看|检查|生成|写|起草|安排|总结|找出|寻找|挖掘|推进|规划|计划|拆解/;
  const kind: IntakeKind = taskPattern.test(normalizedText) ? 'task' : 'question';
  const riskLevel: RiskLevel = reasons.length > 0 ? 'high' : 'low';

  return {
    kind,
    normalizedText,
    title: normalizedText.slice(0, 80),
    riskLevel,
    requiredApprovalAction,
    reasons
  };
}
