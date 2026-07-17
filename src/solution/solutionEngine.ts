import { selectSkillsForText, type SkillDefinition } from '../skills/registry.js';

export interface SolutionDraft {
  workflow: 'solution';
  originalText: string;
  problemStatement: string;
  selectedSkillIds: string[];
  assumptions: string[];
  evidencePlan: string[];
  options: Array<{
    name: string;
    summary: string;
    bestFor: string;
  }>;
  recommendation: string;
  risks: string[];
  executionPlan: Array<{
    horizon: '7d' | '30d' | '90d';
    actions: string[];
  }>;
  nextAgentTasks: Array<{
    title: string;
    ownerAgent: string;
    description: string;
  }>;
  confidence: 'low' | 'medium' | 'high';
}

export function buildSolutionDraft(text: string): SolutionDraft {
  const selection = selectSkillsForText(text, [
    'function.market_research',
    'function.finance_modeling',
    'function.project_management',
    'function.compliance_check'
  ]);
  const selectedSkills = [
    ...selection.industrySkills,
    ...selection.functionSkills,
    ...selection.executionSkills
  ];
  const industryNames = selection.industrySkills.map((skill) => skill.displayName).join('、');
  const functionNames = selection.functionSkills.map((skill) => skill.displayName).join('、');
  const isProspectingRelated = /客户|线索|获客|销售|触达|prospect/i.test(text);

  return {
    workflow: 'solution',
    originalText: text,
    problemStatement: `把请求转成可验证方案：${text.slice(0, 160)}`,
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    assumptions: [
      '当前 MVP 不直接声称已完成联网调研；公开资料研究会作为后续工具任务进入队列。',
      '缺少预算、城市、目标客户、已有资源等信息时，先输出可验证假设并标记为待确认。',
      '法律、税务、医疗、投资等高风险结论只作为常识性风险提示。'
    ],
    evidencePlan: buildEvidencePlan(selectedSkills),
    options: [
      {
        name: '低成本验证方案',
        summary: '先用最小预算验证需求、获客渠道和交付可行性，避免直接重资产投入。',
        bestFor: '预算有限、市场不确定、需要 2-4 周快速判断的场景。'
      },
      {
        name: '标准落地方案',
        summary: '同时推进市场调研、客户访谈、报价/产品包、交付 SOP 和销售漏斗。',
        bestFor: '已有明确服务能力，希望 30-90 天形成稳定获客和交付节奏的场景。'
      },
      {
        name: '增长加速方案',
        summary: '在验证通过后扩大线索来源、内容渠道、合作渠道或付费投放。',
        bestFor: '已有早期成交或强需求信号，准备扩大投入的场景。'
      }
    ],
    recommendation: `先按“低成本验证方案”执行，并调用 ${industryNames || '行业'} Skill 与 ${functionNames || '职能'} Skill 形成可复盘证据。`,
    risks: [
      '公开资料可能过时，需要在执行阶段补充来源和时间戳。',
      '缺少真实客户访谈会导致需求判断偏乐观。',
      '若涉及外部承诺、付款、开票、合同或批量触达，需要进入确认。'
    ],
    executionPlan: [
      {
        horizon: '7d',
        actions: ['补齐关键输入', '列出 5-10 个竞品或替代方案', '设计验证指标', isProspectingRelated ? '定义第一版 ICP' : '访谈 3-5 个目标用户']
      },
      {
        horizon: '30d',
        actions: ['完成首轮公开资料研究', '跑通一个最小交付或最小销售实验', '记录成本、时间、转化和反馈', '复盘是否继续投入']
      },
      {
        horizon: '90d',
        actions: ['沉淀 SOP 和报价规则', '建立稳定获客来源', '形成复盘节奏', '决定扩张、转向或停止']
      }
    ],
    nextAgentTasks: [
      {
        title: '定义问题、约束和成功指标',
        ownerAgent: 'solution',
        description: '把用户请求整理成目标、范围、约束、关键假设和验收标准。'
      },
      {
        title: '收集证据并标记假设来源',
        ownerAgent: 'research',
        description: '把公开资料、用户输入、已审核知识和临时假设分层记录。'
      },
      {
        title: '调用行业 Skill 和职能 Skill 生成初版方案',
        ownerAgent: 'skill_router',
        description: `已选择 Skill：${selectedSkills.map((skill) => skill.id).join(', ')}`
      },
      {
        title: '形成预算、资源和关键指标假设',
        ownerAgent: 'finance',
        description: '生成启动成本、毛利、现金流、转化指标和需要补证的数据点。'
      },
      {
        title: '生成风险清单和 7/30/90 天执行计划',
        ownerAgent: 'solution',
        description: '输出选项、推荐、风险、证据计划和下一步 Agent 任务。'
      },
      {
        title: '复核方案质量并准备复盘指标',
        ownerAgent: 'ops',
        description: '检查方案是否缺关键假设、过度乐观、缺验证指标或触发审批边界。'
      }
    ],
    confidence: 'medium'
  };
}

export function renderSolutionDraft(draft: SolutionDraft) {
  return [
    'V3 Solution Engine 已创建方案任务。',
    '',
    `问题重述：${draft.problemStatement}`,
    `置信度：${draft.confidence}`,
    '',
    '调用 Skill：',
    ...draft.selectedSkillIds.map((skillId) => `- ${skillId}`),
    '',
    '关键假设：',
    ...draft.assumptions.map((item) => `- ${item}`),
    '',
    '推荐方案：',
    draft.recommendation,
    '',
    '执行计划：',
    ...draft.executionPlan.map((bucket) => `- ${bucket.horizon}：${bucket.actions.join('；')}`),
    '',
    '风险：',
    ...draft.risks.map((risk) => `- ${risk}`)
  ].join('\n');
}

function buildEvidencePlan(skills: SkillDefinition[]) {
  const evidence = new Set<string>([
    '记录用户原始请求和关键约束。',
    '把公开资料、用户口头信息、已审核知识和临时假设分层标记。'
  ]);

  for (const skill of skills) {
    for (const output of skill.outputs.slice(0, 2)) {
      evidence.add(`为 ${skill.displayName} 收集证据：${output}`);
    }
  }

  return [...evidence].slice(0, 8);
}
