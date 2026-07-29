import { describe, expect, it } from 'vitest';
import { classifyFinanceCategory, isFinanceDashboardRequest, parseFinanceInstruction } from '../src/finance/financeIntake.js';

describe('finance intake', () => {
  it('parses manual income and expense records', () => {
    expect(parseFinanceInstruction('记录收入 12000 元 来自 Acme，企业版订阅。')).toMatchObject({
      kind: 'transaction',
      direction: 'income',
      amount: 12000,
      currency: 'CNY',
      counterparty: 'Acme'
    });

    expect(parseFinanceInstruction('记录支出 299 元 给 Vercel，云服务订阅。')).toMatchObject({
      kind: 'transaction',
      direction: 'expense',
      amount: 299,
      currency: 'CNY',
      counterparty: 'Vercel',
      category: 'infrastructure'
    });
  });

  it('parses subscriptions and invoices', () => {
    expect(parseFinanceInstruction('记录订阅 Vercel 每月 20 美元 下次扣费 2026-07-01。')).toMatchObject({
      kind: 'subscription',
      vendorName: 'Vercel',
      amount: 20,
      currency: 'USD',
      interval: 'monthly',
      nextBillingAt: '2026-07-01'
    });

    expect(parseFinanceInstruction('记录发票 给 Acme 12000 元 状态 sent 到期 2026-06-30。')).toMatchObject({
      kind: 'invoice',
      customerName: 'Acme',
      amount: 12000,
      currency: 'CNY',
      status: 'sent',
      dueAt: '2026-06-30'
    });
  });

  it('detects dashboard requests and categories', () => {
    expect(isFinanceDashboardRequest('这个月现金流怎么样？')).toBe(true);
    expect(isFinanceDashboardRequest('打开财务看板')).toBe(true);
    expect(isFinanceDashboardRequest('去查一下财务状况')).toBe(true);
    expect(isFinanceDashboardRequest('看看财务情况')).toBe(true);
    expect(isFinanceDashboardRequest('今天任务是什么？')).toBe(false);
    expect(classifyFinanceCategory('广告投放')).toBe('marketing');
  });
});
