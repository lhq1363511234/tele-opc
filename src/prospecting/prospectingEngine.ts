import { selectSkillsForText } from '../skills/registry.js';

export interface ProspectingDraft {
  workflow: 'prospecting';
  originalText: string;
  selectedSkillIds: string[];
  icp: {
    segment: string;
    region: string;
    companySize: string;
    buyingSignals: string[];
    exclusions: string[];
  };
  sourceStrategy: Array<{
    source: string;
    purpose: string;
    exampleSearch: string;
  }>;
  scoringModel: Array<{
    field: string;
    weight: number;
    description: string;
  }>;
  outreachDrafts: string[];
  sequence: Array<{
    day: number;
    action: string;
  }>;
  complianceNotes: string[];
  nextAgentTasks: Array<{
    title: string;
    ownerAgent: string;
    description: string;
  }>;
}

export interface ProspectingLeadCandidate {
  name: string;
  source: string;
  query: string;
  score: Record<string, number>;
  totalScore: number;
  priority: 'A' | 'B' | 'C';
  reasons: string[];
  enrichmentFields: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export function buildProspectingDraft(text: string): ProspectingDraft {
  const selection = selectSkillsForText(text, ['function.prospecting', 'function.crm_followup']);
  const region = extractRegion(text);
  const companySize = extractCompanySize(text);
  const segment = extractSegment(text);
  const buyingSignals = extractBuyingSignals(text);
  const selectedSkills = [
    ...selection.industrySkills,
    ...selection.functionSkills,
    ...selection.executionSkills
  ];

  return {
    workflow: 'prospecting',
    originalText: text,
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    icp: {
      segment,
      region,
      companySize,
      buyingSignals,
      exclusions: ['无公开触达入口', '行业明显不匹配', '只适合个人消费而非目标 B2B 场景', '需要购买隐私数据才能触达']
    },
    sourceStrategy: [
      {
        source: '搜索引擎和官网',
        purpose: '找到公司官网、业务范围、联系入口和近期动态。',
        exampleSearch: `${region} ${segment} 官网 联系方式`
      },
      {
        source: '招聘网站',
        purpose: '用招聘岗位识别扩张、IT、运营、数字化和预算信号。',
        exampleSearch: `${region} ${segment} 招聘 IT 运营 数字化`
      },
      {
        source: '产业园/协会/名录',
        purpose: '构建公开账户池，避免只依赖随机搜索。',
        exampleSearch: `${region} ${segment} 企业名录 产业园 协会`
      },
      {
        source: '新闻和公告',
        purpose: '寻找融资、扩张、新业务、系统升级等触发事件。',
        exampleSearch: `${region} ${segment} 融资 扩张 新业务`
      }
    ],
    scoringModel: [
      { field: 'fit_score', weight: 30, description: '行业、地域、规模和业务复杂度是否符合 ICP。' },
      { field: 'intent_score', weight: 25, description: '是否存在招聘、扩张、融资、官网改版、数字化岗位等购买信号。' },
      { field: 'accessibility_score', weight: 15, description: '是否有官网、邮箱、表单、电话、社媒或明确联系人。' },
      { field: 'value_score', weight: 15, description: '潜在合同金额、长期服务价值或复购可能性。' },
      { field: 'risk_score', weight: 10, description: '合规、敏感行业、数据质量和触达风险。' },
      { field: 'confidence_score', weight: 5, description: '公开来源是否可靠，是否需要人工复核。' }
    ],
    outreachDrafts: [
      `主题：想和你们聊聊 ${segment} 的效率提升空间`,
      `你好，我在整理 ${region} ${segment} 公司的公开信息，看到你们可能正在扩张或优化运营。想先发一份简短诊断清单，看看是否有可节省时间或成本的点。`,
      '如果你方便，我可以先用 15 分钟了解现状，再判断是否值得继续。'
    ],
    sequence: [
      { day: 0, action: '发送个性化首触达草稿，引用公开信号和一个明确痛点。' },
      { day: 3, action: '跟进一个案例或检查清单，不催促成交。' },
      { day: 7, action: '询问是否愿意做一次免费初筛，未回复则降频。' },
      { day: 14, action: '最后一次轻触达，然后进入 nurture 或关闭。' }
    ],
    complianceNotes: [
      '当前会生成公开信息研究计划、触达草稿和 campaign；邮件发送可通过 /send_campaign 自动执行。',
      '购买联系人数据、付费数据源、广告投放、非邮件批量触达、提交网页表单都必须确认。',
      '触达内容应包含真实身份、合理目的和退订/停止联系选项。'
    ],
    nextAgentTasks: [
      {
        title: '定义 ICP 和排除条件',
        ownerAgent: 'icp',
        description: `地域：${region}；规模：${companySize}；领域：${segment}`
      },
      {
        title: '制定公开线索来源和搜索批次',
        ownerAgent: 'prospecting',
        description: '生成搜索关键词、来源优先级和证据保存要求。'
      },
      {
        title: '抓取候选账户并保存来源证据',
        ownerAgent: 'research',
        description: '从搜索、官网、招聘网站、产业园和公开名录整理候选公司。'
      },
      {
        title: '发现联系人和公开触达入口',
        ownerAgent: 'prospecting',
        description: '补充官网、邮箱、表单、电话、社媒和公开联系人线索。'
      },
      {
        title: '补全候选账户字段并评分',
        ownerAgent: 'lead_scoring',
        description: '按 fit、intent、accessibility、value、risk、confidence 评分。'
      },
      {
        title: '生成触达草稿和 14 天 sequence',
        ownerAgent: 'sales_sequence',
        description: '生成草稿、内部跟进任务和可由发送器执行的邮件 campaign。'
      },
      {
        title: '写入 CRM 管道和内部跟进任务',
        ownerAgent: 'crm',
        description: '把合格账户、评分、来源和下一步动作写入 CRM 或 prospecting 表。'
      },
      {
        title: '检查外发、数据源和表单提交边界',
        ownerAgent: 'prospecting',
        description: '购买数据、广告投放、非邮件批量触达、外部表单提交必须升级确认。'
      }
    ]
  };
}

export function buildProspectingLeadCandidates(draft: ProspectingDraft, limit = 6): ProspectingLeadCandidate[] {
  const candidates: ProspectingLeadCandidate[] = [];
  const sources = draft.sourceStrategy.slice(0, Math.max(1, Math.min(limit, draft.sourceStrategy.length)));

  for (const [index, source] of sources.entries()) {
    const score = scoreCandidate(draft, source.source, index);
    const totalScore = Object.values(score).reduce((sum, value) => sum + value, 0);
    const priority = totalScore >= 78 ? 'A' : totalScore >= 64 ? 'B' : 'C';
    const sourceLabel = source.source.replace(/[\/\s]+/g, '').slice(0, 10);
    const name = `${draft.icp.region} ${draft.icp.segment} ${sourceLabel}候选账户 ${index + 1}`;

    candidates.push({
      name,
      source: source.source,
      query: source.exampleSearch,
      score,
      totalScore,
      priority,
      reasons: [
        `符合 ICP：${draft.icp.region} / ${draft.icp.segment} / ${draft.icp.companySize}`,
        `来源策略：${source.source}`,
        draft.icp.buyingSignals[0] ? `购买信号：${draft.icp.buyingSignals[0]}` : '购买信号待公开来源验证',
        '当前为候选线索种子，需要后续公开来源 connector 复核官网和联系方式。'
      ],
      enrichmentFields: {
        region: draft.icp.region,
        segment: draft.icp.segment,
        companySize: draft.icp.companySize,
        buyingSignals: draft.icp.buyingSignals,
        exclusions: draft.icp.exclusions,
        evidenceStatus: 'needs_public_verification'
      },
      sources: [
        {
          type: 'planned_public_source',
          name: source.source,
          query: source.exampleSearch,
          purpose: source.purpose,
          evidenceStatus: 'planned'
        }
      ],
      metadata: {
        workflow: 'prospecting',
        source: 'prospecting_candidate_seed_v1',
        originalText: draft.originalText,
        selectedSkillIds: draft.selectedSkillIds
      }
    });
  }

  return candidates.slice(0, limit);
}

export function renderProspectingDraft(draft: ProspectingDraft) {
  return [
    'V3 Prospecting & Sales Engine 已创建客户挖掘任务。',
    '',
    `ICP：${draft.icp.region} / ${draft.icp.segment} / ${draft.icp.companySize}`,
    '',
    '调用 Skill：',
    ...draft.selectedSkillIds.map((skillId) => `- ${skillId}`),
    '',
    '购买信号：',
    ...draft.icp.buyingSignals.map((signal) => `- ${signal}`),
    '',
    '线索来源策略：',
    ...draft.sourceStrategy.map((item) => `- ${item.source}：${item.purpose}`),
    '',
    '评分模型：',
    ...draft.scoringModel.map((item) => `- ${item.field} (${item.weight})：${item.description}`),
    '',
    '触达边界：',
    ...draft.complianceNotes.map((item) => `- ${item}`)
  ].join('\n');
}

export function renderProspectingLeadCandidates(candidates: ProspectingLeadCandidate[]) {
  if (!candidates.length) return '候选线索：暂无。';
  return [
    `候选线索种子：${candidates.length} 条`,
    ...candidates.map(
      (candidate, index) =>
        `${index + 1}. ${candidate.name} / ${candidate.priority} / ${candidate.totalScore}\n   来源：${candidate.source}\n   查询：${candidate.query}`
    )
  ].join('\n');
}

function scoreCandidate(draft: ProspectingDraft, sourceName: string, index: number) {
  const hasKnownRegion = !draft.icp.region.includes('待确认');
  const hasKnownSize = !draft.icp.companySize.includes('待确认');
  const signalBonus = Math.min(8, draft.icp.buyingSignals.length * 2);
  const sourceBonus = /招聘|新闻|官网/.test(sourceName) ? 4 : 2;
  const decay = index * 2;

  return {
    fit_score: clampScore(24 + (hasKnownRegion ? 4 : 0) + (hasKnownSize ? 4 : 0) - decay, 0, 30),
    intent_score: clampScore(16 + signalBonus + sourceBonus - decay, 0, 25),
    accessibility_score: clampScore(/官网|名录|协会/.test(sourceName) ? 12 : 9, 0, 15),
    value_score: clampScore(10 + (hasKnownSize ? 3 : 0), 0, 15),
    risk_score: clampScore(7, 0, 10),
    confidence_score: clampScore(3 + (sourceBonus > 2 ? 1 : 0), 0, 5)
  };
}

function clampScore(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function extractRegion(text: string) {
  const cities = ['深圳', '上海', '北京', '广州', '杭州', '成都', '苏州', '南京', '武汉', '西安'];
  return cities.find((city) => text.includes(city)) ?? '目标地区待确认';
}

function extractCompanySize(text: string) {
  const match = text.match(/(\d+\s*[-到至]\s*\d+\s*人|\d+\s*人以上|\d+\s*人以下)/);
  return match?.[1].replace(/\s+/g, '') ?? '公司规模待确认';
}

function extractSegment(text: string) {
  const patterns = [
    /挖掘(.+?)(?:的潜在客户|客户|线索)/,
    /找(.+?)(?:的潜在客户|客户|线索)/,
    /面向(.+?)(?:的潜在客户|客户|线索)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().slice(0, 40);
  }
  if (/数字化|企业服务|SaaS|软件|系统|自动化/i.test(text)) return '企业数字化/软件服务';
  return '目标领域待确认';
}

function extractBuyingSignals(text: string) {
  const signals = ['近期招聘相关岗位', '官网存在联系入口', '业务复杂度较高'];
  if (/融资|扩张|新业务/.test(text)) signals.push('融资、扩张或新业务信号');
  if (/IT|技术|系统|数字化|运营/.test(text)) signals.push('IT、系统、数字化或运营岗位信号');
  if (/50|100|300|规模|人/.test(text)) signals.push('公司规模符合服务型销售门槛');
  return signals;
}
