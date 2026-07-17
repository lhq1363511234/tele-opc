import { describe, expect, it } from 'vitest';
import { isBrowserDashboardRequest, parseBrowserInstruction } from '../src/browser/browserIntake.js';

describe('browser intake', () => {
  it('parses allowed browser inspection requests', () => {
    const result = parseBrowserInstruction('去 Stripe 看看最近失败付款，整理原因。');

    expect(result).toMatchObject({
      targetUrl: 'https://dashboard.stripe.com',
      targetDomain: 'dashboard.stripe.com',
      isAllowedDomain: true
    });
    expect(result?.requestedActions).toContain('open_page');
    expect(result?.requestedActions).toContain('screenshot');
    expect(result?.requestedActions).toContain('extract_data');
    expect(result?.blockedActions).toHaveLength(0);
  });

  it('blocks submit actions and non-allowlisted domains', () => {
    const result = parseBrowserInstruction('打开 https://example.org 后提交表单。');

    expect(result?.isAllowedDomain).toBe(false);
    expect(result?.blockedActions.map((action) => action.actionType)).toContain('domain_not_allowed');
    expect(result?.blockedActions.map((action) => action.actionType)).toContain('submit_form');
    expect(result?.blockedActions.find((action) => action.actionType === 'submit_form')?.approvalAction).toBe('submit_external_form');
  });

  it('detects browser dashboard requests', () => {
    expect(isBrowserDashboardRequest('打开浏览器看板')).toBe(true);
    expect(isBrowserDashboardRequest('最近浏览器运行怎么样？')).toBe(true);
    expect(isBrowserDashboardRequest('打开财务看板')).toBe(false);
  });
});
