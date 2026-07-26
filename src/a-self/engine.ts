import type { Repositories } from '../db/repositories.js';

export async function runASelfMorningScan(repos: Repositories) {
  const profile = await repos.getASelfProfile();
  if (!profile) return null;

  // 1. 获取近期未处理的线索、邮件和等待执行的规划
  const crmLeads = await repos.listBusinessAnalyticsFacts(10) ?? [];
  const inbox = await repos.listRecentMessages?.(10) ?? [];
  const plannedTasks = await repos.listTasksByStatuses?.(['planned'], 10) ?? [];

  // 2. 根据 A- 基因生成扫描结论
  const recommendations = [];
  if (crmLeads.length > 9999) {
    recommendations.push(`现有 ${crmLeads.length} 个新线索待跟进。A- 建议：符合“长期成长”的线索优先。`);
  }
  if (plannedTasks.length > 0) {
    recommendations.push(`积压了 ${plannedTasks.length} 个任务。A- 建议：低成本验证需求，再投入时间。`);
  }
  if (recommendations.length === 0) {
    recommendations.push('早晨市场扫描完成，目前暂无需要立刻关注的异常信号，可保持聚焦。');
  }

  const run = await repos.createASelfOpcRun({
    runType: 'morning',
    title: '早间市场扫描与目标对齐',
    marketScan: '扫描社交动态、待处理线索和系统任务。',
    companyState: `当前有 ${plannedTasks.length} 个计划中任务。`,
    recommendations: recommendations.join('\n'),
    metrics: { scannedItems: inbox.length },
    status: 'ready',
    metadata: { source: 'a_self_engine' }
  });

  return run;
}

export async function runASelfEveningSummary(repos: Repositories) {
  const profile = await repos.getASelfProfile();
  if (!profile) return null;

  // 1. 获取今天已完成的任务、产生的交易和新建的记忆
  const completedTasks = await repos.listTasksByStatuses?.(['done'], 10) ?? [];
  const recentMemories = await repos.listASelfMemoryItems(5) ?? [];

  // 2. 根据 A- 基因生成复盘
  const recommendations = [];
  if (completedTasks.length > 0) {
    recommendations.push(`今日完成了 ${completedTasks.length} 个任务。`);
  }
  if (recentMemories.length > 0) {
    recommendations.push(`新增了 ${recentMemories.length} 条记忆（$\Delta$）。继续保持积累复利。`);
  }
  if (recommendations.length === 0) {
    recommendations.push('今日没有系统层面的增量数据，回顾是否偏离了主线？');
  }

  const run = await repos.createASelfOpcRun({
    runType: 'evening',
    title: '晚间经营复盘',
    marketScan: null,
    companyState: `今日增量：${completedTasks.length} 任务，${recentMemories.length} 记忆。`,
    recommendations: recommendations.join('\n'),
    metrics: { completedTasks: completedTasks.length, newMemories: recentMemories.length },
    status: 'ready',
    metadata: { source: 'a_self_engine' }
  });

  return run;
}
