const defaultAllowedDomains = ['stripe.com', 'github.com', 'google.com'];

const knownTargets: Array<{ pattern: RegExp; url: string }> = [
  { pattern: /stripe/i, url: 'https://dashboard.stripe.com' },
  { pattern: /github/i, url: 'https://github.com' },
  { pattern: /google/i, url: 'https://google.com' }
];

export interface BrowserBlockedAction {
  actionType: string;
  reason: string;
  approvalAction?: string;
}

export interface BrowserIntake {
  goal: string;
  targetUrl: string;
  targetDomain: string;
  isAllowedDomain: boolean;
  allowedDomains: string[];
  requestedActions: string[];
  blockedActions: BrowserBlockedAction[];
}

export function parseBrowserInstruction(text: string): BrowserIntake | null {
  const normalizedText = text.trim();
  if (!/(浏览器|网页|网站|后台|打开|访问|去).*(看|看看|检查|整理|提取|截图|填写|提交|保存|发布|删除|付款|购买|退款|登录|表单)|browser|website|dashboard/i.test(normalizedText)) {
    return null;
  }

  const targetUrl = extractTargetUrl(normalizedText);
  if (!targetUrl) return null;

  const targetDomain = extractDomain(targetUrl);
  const allowedDomains = defaultAllowedDomains;
  const isAllowedDomain = isDomainAllowed(targetDomain, allowedDomains);
  const blockedActions = detectBlockedActions(normalizedText);
  if (!isAllowedDomain) {
    blockedActions.unshift({
      actionType: 'domain_not_allowed',
      reason: `Domain ${targetDomain} is not in the browser allowlist.`
    });
  }

  return {
    goal: normalizedText,
    targetUrl,
    targetDomain,
    isAllowedDomain,
    allowedDomains,
    requestedActions: detectRequestedActions(normalizedText),
    blockedActions
  };
}

export function isBrowserDashboardRequest(text: string) {
  return /浏览器看板|browser dashboard|浏览器运行|最近.*浏览器|被拦截.*浏览器/i.test(text.trim());
}

export function isDomainAllowed(domain: string, allowedDomains = defaultAllowedDomains) {
  const normalizedDomain = domain.toLowerCase();
  return allowedDomains.some((allowed) => normalizedDomain === allowed || normalizedDomain.endsWith(`.${allowed}`));
}

function extractTargetUrl(text: string) {
  const explicitUrl = text.match(/\bhttps?:\/\/[^\s，。；;]+/i);
  if (explicitUrl?.[0]) return explicitUrl[0];

  const domain = text.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (domain?.[1]) return `https://${domain[1]}`;

  const known = knownTargets.find((target) => target.pattern.test(text));
  return known?.url;
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '').toLowerCase();
  }
}

function detectRequestedActions(text: string) {
  const actions = new Set(['open_page', 'read_page', 'screenshot', 'extract_data']);
  if (/填写|输入|填表|表单|fill/i.test(text)) actions.add('fill_form');
  if (/提交|submit/i.test(text)) actions.add('submit_form');
  if (/保存|save/i.test(text)) actions.add('save_form');
  if (/发布|publish|上线/i.test(text)) actions.add('publish_content');
  if (/删除|清空|移除|delete/i.test(text)) actions.add('delete_remote_data');
  if (/点击|click/i.test(text)) actions.add('controlled_click');
  return [...actions];
}

function detectBlockedActions(text: string): BrowserBlockedAction[] {
  const actions: BrowserBlockedAction[] = [];

  if (/提交|submit/i.test(text)) {
    actions.push({
      actionType: 'submit_form',
      approvalAction: 'submit_external_form',
      reason: 'External form submissions require owner confirmation in V3.'
    });
  }

  if (/退款|refund/i.test(text)) {
    actions.push({
      actionType: 'finance_refund',
      approvalAction: 'refund',
      reason: 'Refund actions require owner confirmation in V3.'
    });
  }

  if (isPaymentExecution(text)) {
    actions.push({
      actionType: 'finance_payment',
      approvalAction: 'payment',
      reason: 'Payment, purchase, or transfer actions require owner confirmation in V3.'
    });
  }

  if (/账单|发票|订阅|扣费|billing|invoice|subscription/i.test(text) && /修改|变更|取消|保存|提交|change|cancel|save|submit/i.test(text)) {
    actions.push({
      actionType: 'finance_billing_change',
      approvalAction: 'billing_change',
      reason: 'Billing, invoice, or subscription changes require owner confirmation in V3.'
    });
  }

  return actions;
}

function isPaymentExecution(text: string) {
  if (/purchase|pay|transfer/i.test(text)) return true;
  if (/支付|转账|购买|下单|扣款/.test(text)) return true;
  if (!/付款/.test(text)) return false;
  if (/失败付款|付款失败/.test(text) && !/提交|重试|确认|执行|发起|处理/.test(text)) return false;
  return /提交|重试|确认|执行|发起|处理|付款/.test(text);
}
