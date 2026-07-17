import { describe, expect, it } from 'vitest';
import {
  assertDistributionReadiness,
  evaluateDistributionReadiness
} from '../../src/appos/domains/cps/distribution-readiness.js';

const readyProfile = {
  'Profile名称': 'facebook-01',
  '登录状态': '已登录',
  'cleanip分数': 94,
  'Proxy状态': '合格'
};

const readyAccount = {
  平台: 'Facebook',
  '账号昵称': 'Page A',
  '绑定Profile名称': 'facebook-01',
  当前短剧名: 'The Lost Heiress',
  当前短剧链接: 'https://short.example/drama',
  当前App链接: 'https://app.example/install',
  报白状态: '已报白',
  登录状态: '已登录',
  是否启用: true
};

describe('distribution readiness gate', () => {
  it('passes a fully ready Feishu profile and platform account row', () => {
    const result = evaluateDistributionReadiness({
      profileRow: readyProfile,
      accountRow: readyAccount
    });

    expect(result).toMatchObject({
      ok: true,
      reasons: [],
      context: {
        platform: 'Facebook',
        accountName: 'Page A',
        profileName: 'facebook-01',
        currentDramaName: 'The Lost Heiress',
        shortDramaLink: 'https://short.example/drama',
        appLink: 'https://app.example/install',
        cleanipScore: 94
      }
    });
  });

  it('fails when account is disabled', () => {
    const result = evaluateDistributionReadiness({
      profileRow: readyProfile,
      accountRow: { ...readyAccount, 是否启用: false }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('平台账号未启用');
  });

  it('fails when no linked profile name is configured', () => {
    const result = evaluateDistributionReadiness({
      profileRow: readyProfile,
      accountRow: { ...readyAccount, 绑定Profile名称: '' }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('平台账号缺少绑定Profile名称');
  });

  it('fails when the linked profile row does not match the account binding', () => {
    const result = evaluateDistributionReadiness({
      profileRow: { ...readyProfile, 'Profile名称': 'tiktok-01' },
      accountRow: readyAccount
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('平台账号绑定Profile名称 facebook-01 与Profile资产行 tiktok-01 不一致');
  });

  it('requires account and profile login status to be 已登录', () => {
    const result = evaluateDistributionReadiness({
      profileRow: { ...readyProfile, 登录状态: '登录失效' },
      accountRow: { ...readyAccount, 登录状态: '未登录' }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('平台账号登录状态必须为已登录');
    expect(result.reasons).toContain('Profile登录状态必须为已登录');
  });

  it('requires report status 已报白 or 不需要', () => {
    const result = evaluateDistributionReadiness({
      profileRow: readyProfile,
      accountRow: { ...readyAccount, 报白状态: '未报白' }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('报白状态必须为已报白或不需要');
  });

  it('requires current drama name, short drama link, and app link', () => {
    const result = evaluateDistributionReadiness({
      profileRow: readyProfile,
      accountRow: { ...readyAccount, 当前短剧名: '', 当前短剧链接: '', 当前App链接: '' }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining(['缺少当前短剧名', '缺少当前短剧链接', '缺少当前App链接'])
    );
  });

  it('requires cleanip score >= 90', () => {
    const result = evaluateDistributionReadiness({
      profileRow: { ...readyProfile, 'cleanip分数': 89 },
      accountRow: readyAccount
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('cleanip score 89 is below required threshold 90');
  });

  it('throws from the gate when readiness fails', () => {
    const result = evaluateDistributionReadiness({
      profileRow: { ...readyProfile, 'cleanip分数': 80 },
      accountRow: { ...readyAccount, 是否启用: false }
    });

    expect(() => assertDistributionReadiness(result)).toThrow(
      'Distribution readiness failed: 平台账号未启用; cleanip score 80 is below required threshold 90'
    );
  });
});
