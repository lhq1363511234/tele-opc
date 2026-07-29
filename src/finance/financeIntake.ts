import type { InvoiceStatus, TransactionDirection } from '../types.js';

export type FinanceIntake =
  | {
      kind: 'transaction';
      direction: TransactionDirection;
      amount: number;
      currency: string;
      counterparty?: string;
      category?: string;
      description: string;
    }
  | {
      kind: 'invoice';
      customerName: string;
      amount: number;
      currency: string;
      status: InvoiceStatus;
      dueAt?: string;
      description: string;
    }
  | {
      kind: 'subscription';
      vendorName: string;
      amount: number;
      currency: string;
      interval: string;
      nextBillingAt?: string;
      category?: string;
      description: string;
    };

export function parseFinanceInstruction(text: string): FinanceIntake | null {
  const normalizedText = text.trim();
  if (!/(记录|新增|保存|导入).*(收入|支出|交易|订阅|发票|账单)/i.test(normalizedText)) return null;

  const money = extractMoney(normalizedText);
  if (!money) return null;

  if (/收入|支出|交易|收款|到账|进账/i.test(normalizedText)) {
    const direction: TransactionDirection = /收入|收款|到账|进账/i.test(normalizedText) ? 'income' : 'expense';
    const counterparty = extractCounterparty(
      normalizedText,
      direction === 'income' ? ['来自', '客户', 'from'] : ['给', '支付给', '供应商', 'vendor']
    );

    return {
      kind: 'transaction',
      direction,
      amount: money.amount,
      currency: money.currency,
      counterparty: counterparty ?? inferNamedEntity(normalizedText),
      category: classifyFinanceCategory(normalizedText),
      description: normalizedText
    };
  }

  if (/订阅|续费/i.test(normalizedText)) {
    const vendorName = extractCounterparty(normalizedText, ['给', '供应商', 'vendor', '来自']) ?? inferNamedEntity(normalizedText) ?? '未知供应商';
    return {
      kind: 'subscription',
      vendorName,
      amount: money.amount,
      currency: money.currency,
      interval: extractInterval(normalizedText),
      nextBillingAt: extractDateAfter(normalizedText, ['下次扣费', '下次付款', 'next billing', 'next']),
      category: classifyFinanceCategory(normalizedText),
      description: normalizedText
    };
  }

  if (/发票|账单/i.test(normalizedText)) {
    const customerName = extractCounterparty(normalizedText, ['给', '客户', '来自', 'from']) ?? inferNamedEntity(normalizedText) ?? '未知客户';
    return {
      kind: 'invoice',
      customerName,
      amount: money.amount,
      currency: money.currency,
      status: extractInvoiceStatus(normalizedText),
      dueAt: extractDateAfter(normalizedText, ['到期', 'due', '截止']),
      description: normalizedText
    };
  }

  return {
    kind: 'transaction',
    direction: 'expense',
    amount: money.amount,
    currency: money.currency,
    counterparty: inferNamedEntity(normalizedText),
    category: classifyFinanceCategory(normalizedText),
    description: normalizedText
  };
}

export function isFinanceDashboardRequest(text: string) {
  return /财务看板|财务状况|财务情况|查(?:一下)?财务|看看财务|查看财务|财务怎么样|收支|现金流|本月收入|本月支出|未收发票|即将扣费|查账|账本|finance dashboard|cash\s*flow/i.test(text.trim());
}

export function classifyFinanceCategory(text: string) {
  if (/云|服务器|hosting|vercel|aws|cloudflare|域名/i.test(text)) return 'infrastructure';
  if (/订阅|软件|saas|license|工具/i.test(text)) return 'software';
  if (/广告|投放|营销|marketing/i.test(text)) return 'marketing';
  if (/工资|外包|freelance|contractor/i.test(text)) return 'labor';
  if (/税|tax/i.test(text)) return 'tax';
  if (/客户|收入|收款|发票/i.test(text)) return 'revenue';
  return undefined;
}

function extractMoney(text: string) {
  const match = text.match(/(?:CNY|RMB|人民币|￥|¥|\$|USD|美元)?\s*([0-9]+(?:\.[0-9]+)?)\s*(元|人民币|块|CNY|RMB|美元|USD|刀)?/i);
  if (!match?.[1]) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const currencyToken = `${match[0]} ${match[2] ?? ''}`;
  const currency = /美元|USD|\$/i.test(currencyToken) ? 'USD' : 'CNY';
  return { amount, currency };
}

function extractCounterparty(text: string, markers: string[]) {
  for (const marker of markers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*([A-Za-z0-9_\\-\\u4e00-\\u9fa5]+)`, 'i'));
    if (match?.[1]) return cleanup(match[1]);
  }
  return undefined;
}

function inferNamedEntity(text: string) {
  const match = text.match(/\b([A-Z][A-Za-z0-9_-]{1,40})\b/);
  return match?.[1];
}

function extractInterval(text: string) {
  if (/每年|年付|annual|yearly/i.test(text)) return 'yearly';
  if (/每周|weekly/i.test(text)) return 'weekly';
  if (/每天|daily/i.test(text)) return 'daily';
  return 'monthly';
}

function extractInvoiceStatus(text: string): InvoiceStatus {
  if (/已付|paid/i.test(text)) return 'paid';
  if (/逾期|overdue/i.test(text)) return 'overdue';
  if (/已发送|sent/i.test(text)) return 'sent';
  if (/取消|cancel/i.test(text)) return 'cancelled';
  return 'draft';
}

function extractDateAfter(text: string, markers: string[]) {
  for (const marker of markers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*[：:]?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'i'));
    if (match?.[1]) return match[1];
  }
  const fallback = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return fallback?.[1];
}

function cleanup(value: string) {
  return value.trim().replace(/^[：:\s，,]+/, '').replace(/[，,。；;]+$/g, '');
}
