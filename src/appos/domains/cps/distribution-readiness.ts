import type { CleanipProxyScoreResult } from './cleanip-check.js';

export type FeishuLikeRow = Record<string, unknown>;

export type DistributionReadinessInput = {
  profileRow?: FeishuLikeRow;
  accountRow: FeishuLikeRow;
  cleanipResult?: CleanipProxyScoreResult;
  cleanipThreshold?: number;
};

export type DistributionReadinessContext = {
  platform?: string;
  accountName?: string;
  profileName?: string;
  currentDramaName?: string;
  shortDramaLink?: string;
  appLink?: string;
  cleanipScore?: number;
};

export type DistributionReadinessResult = {
  ok: boolean;
  reasons: string[];
  context: DistributionReadinessContext;
};

const DEFAULT_CLEANIP_THRESHOLD = 90;

const readString = (row: FeishuLikeRow | undefined, keys: string[]) => {
  if (!row) return undefined;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
};

const readNumber = (row: FeishuLikeRow | undefined, keys: string[]) => {
  const raw = readString(row, keys);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readEnabled = (row: FeishuLikeRow) => {
  const raw = row['是否启用'] ?? row.enabled ?? row.status;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw !== 'string') return false;
  return ['是', '启用', '已启用', 'true', '1', 'yes', 'active', 'enabled'].includes(raw.trim().toLowerCase());
};

const isLoggedIn = (value: string | undefined) =>
  value === '已登录' || value === 'logged_in' || value === 'logged-in' || value === 'active';

const isReportAllowed = (value: string | undefined) =>
  value === '已报白' || value === '不需要' || value === 'approved' || value === 'not_required';

export function evaluateDistributionReadiness(input: DistributionReadinessInput): DistributionReadinessResult {
  const reasons: string[] = [];
  const threshold = input.cleanipThreshold ?? DEFAULT_CLEANIP_THRESHOLD;
  const account = input.accountRow;
  const profile = input.profileRow;

  const profileName = readString(account, ['绑定Profile名称', '绑定 Profile 名称', 'profileName', 'profile_name']);
  const profileRowName = readString(profile, ['Profile名称', 'Profile 名称', 'profileName', 'profile_name']);
  const accountLoginStatus = readString(account, ['登录状态', 'loginStatus', 'login_status']);
  const profileLoginStatus = readString(profile, ['登录状态', 'loginStatus', 'login_status']);
  const reportStatus = readString(account, ['报白状态', 'reportStatus', 'report_status']);
  const currentDramaName = readString(account, ['当前短剧名', 'currentDramaName', 'current_drama_name']);
  const shortDramaLink = readString(account, ['当前短剧链接', '短剧链接', 'shortDramaLink', 'short_drama_link']);
  const appLink = readString(account, ['当前App链接', '当前 App 链接', 'App链接', 'appLink', 'app_link']);
  const cleanipScore = input.cleanipResult?.score ?? readNumber(profile, ['cleanip分数', 'cleanip 分数', 'cleanipScore', 'cleanip_score']);

  const context: DistributionReadinessContext = {
    platform: readString(account, ['平台', 'platform']),
    accountName: readString(account, ['账号昵称', '账号名称', 'accountName', 'account_name']),
    profileName,
    currentDramaName,
    shortDramaLink,
    appLink,
    cleanipScore
  };

  if (!readEnabled(account)) {
    reasons.push('平台账号未启用');
  }

  if (!profileName) {
    reasons.push('平台账号缺少绑定Profile名称');
  }

  if (!profile) {
    reasons.push('缺少绑定的Profile资产行');
  } else if (profileName && profileRowName && profileName !== profileRowName) {
    reasons.push(`平台账号绑定Profile名称 ${profileName} 与Profile资产行 ${profileRowName} 不一致`);
  }

  if (!isLoggedIn(accountLoginStatus)) {
    reasons.push('平台账号登录状态必须为已登录');
  }

  if (!isLoggedIn(profileLoginStatus)) {
    reasons.push('Profile登录状态必须为已登录');
  }

  if (!isReportAllowed(reportStatus)) {
    reasons.push('报白状态必须为已报白或不需要');
  }

  if (!currentDramaName) reasons.push('缺少当前短剧名');
  if (!shortDramaLink) reasons.push('缺少当前短剧链接');
  if (!appLink) reasons.push('缺少当前App链接');

  if (input.cleanipResult && !input.cleanipResult.passed) {
    reasons.push(input.cleanipResult.reason ?? `cleanip score ${input.cleanipResult.score} is below required threshold ${threshold}`);
  } else if (cleanipScore === undefined) {
    reasons.push('缺少cleanip分数');
  } else if (cleanipScore < threshold) {
    reasons.push(`cleanip score ${cleanipScore} is below required threshold ${threshold}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    context
  };
}

export function assertDistributionReadiness(result: DistributionReadinessResult) {
  if (!result.ok) {
    throw new Error(`Distribution readiness failed: ${result.reasons.join('; ')}`);
  }
}
