export type SkillType = 'industry' | 'function' | 'execution';

export interface SkillDefinition {
  id: string;
  type: SkillType;
  displayName: string;
  summary: string;
  triggers: string[];
  requiredInputs: string[];
  outputs: string[];
  tools: string[];
  riskNotes: string[];
  status: 'built_in' | 'draft';
}

export interface SkillSelection {
  industrySkills: SkillDefinition[];
  functionSkills: SkillDefinition[];
  executionSkills: SkillDefinition[];
  reasons: string[];
}

export const SKILL_REGISTRY: SkillDefinition[] = [
  {
    id: 'industry.restaurant_local_life',
    type: 'industry',
    displayName: '餐饮/本地生活',
    summary: '用于轻食、外卖、门店、本地服务等项目判断、获客和运营方案。',
    triggers: ['餐饮', '轻食', '外卖', '门店', '本地生活', '堂食', '私厨'],
    requiredInputs: ['城市', '预算', '目标客群', '验证周期', '渠道'],
    outputs: ['行业判断', '单位经济模型', '获客渠道', '运营风险', '7/30/90 天计划'],
    tools: ['web_research', 'browser', 'finance_model', 'crm'],
    riskNotes: ['食品安全、证照、平台规则、现金流风险需要标注。'],
    status: 'built_in'
  },
  {
    id: 'industry.cross_border_ecommerce',
    type: 'industry',
    displayName: '跨境电商',
    summary: '用于品类判断、平台选择、供应链、物流、广告和利润模型。',
    triggers: ['跨境', '亚马逊', 'shopify', '独立站', 'Temu', 'TikTok Shop', '电商'],
    requiredInputs: ['品类', '目标市场', '供应链资源', '预算', '平台'],
    outputs: ['品类判断', '渠道策略', '成本模型', '风险清单', '验证计划'],
    tools: ['web_research', 'browser', 'finance_model'],
    riskNotes: ['平台政策、侵权、税务和物流风险需要标注。'],
    status: 'built_in'
  },
  {
    id: 'industry.saas_software_service',
    type: 'industry',
    displayName: 'SaaS / 软件服务',
    summary: '用于 SaaS、软件项目、企业服务和自动化服务的定位、销售和交付方案。',
    triggers: ['SaaS', '软件', '系统', '企业服务', '数字化', '自动化', 'AI 服务', '开发'],
    requiredInputs: ['目标客户', '痛点', '交付范围', '价格区间', '销售渠道'],
    outputs: ['定位', 'ICP', '服务包', '销售漏斗', '交付计划'],
    tools: ['crm', 'prospecting', 'quote', 'dev'],
    riskNotes: ['范围蔓延、交付周期、数据安全和合同承诺需要标注。'],
    status: 'built_in'
  },
  {
    id: 'industry.content_ip_media',
    type: 'industry',
    displayName: '内容 IP / 自媒体',
    summary: '用于账号定位、内容矩阵、增长、商业化和选题计划。',
    triggers: ['自媒体', '内容', 'IP', '账号', '短视频', '小红书', '公众号', 'B站'],
    requiredInputs: ['平台', '目标人群', '内容主题', '商业化方式', '更新频率'],
    outputs: ['定位', '栏目', '选题', '增长实验', '商业化路径'],
    tools: ['content', 'web_research', 'calendar'],
    riskNotes: ['平台规则、版权、广告合规和声誉风险需要标注。'],
    status: 'built_in'
  },
  {
    id: 'function.market_research',
    type: 'function',
    displayName: '市场调研',
    summary: '定义市场、竞品、用户、渠道和关键假设。',
    triggers: ['市场', '调研', '竞品', '需求', '行业判断', '能不能做'],
    requiredInputs: ['目标市场', '目标用户', '地域', '时间范围'],
    outputs: ['市场判断', '竞品摘要', '关键假设', '验证建议'],
    tools: ['web_research', 'browser'],
    riskNotes: ['公开资料必须区分事实、推断和假设。'],
    status: 'built_in'
  },
  {
    id: 'function.prospecting',
    type: 'function',
    displayName: '客户挖掘',
    summary: '从领域、地域和 ICP 生成线索来源、评分和触达计划。',
    triggers: ['挖客户', '客户挖掘', '找客户', '线索', '获客', '销售开发', 'prospect'],
    requiredInputs: ['目标行业', '地域', '客户规模', '痛点信号', '排除条件'],
    outputs: ['ICP', '线索来源', '评分模型', '触达草稿', '销售 sequence'],
    tools: ['browser', 'crm', 'email'],
    riskNotes: ['购买数据源、广告投放、非邮件批量触达、提交表单必须确认；邮件 campaign 可由发送器执行。'],
    status: 'built_in'
  },
  {
    id: 'function.crm_followup',
    type: 'function',
    displayName: 'CRM 跟进',
    summary: '把线索、客户、机会和下一步动作沉淀到 CRM 管道。',
    triggers: ['CRM', '客户跟进', '机会', 'pipeline', '跟进任务'],
    requiredInputs: ['客户/公司', '来源', '阶段', '下一步动作'],
    outputs: ['CRM 记录', '机会阶段', '跟进任务', '复盘字段'],
    tools: ['crm', 'calendar', 'email'],
    riskNotes: ['删除、合并关键客户或外发消息需要按策略确认。'],
    status: 'built_in'
  },
  {
    id: 'function.pricing_quote',
    type: 'function',
    displayName: '定价和报价',
    summary: '从报价规则、服务包和合同条款生成报价草案。',
    triggers: ['报价', '定价', '价格', '服务包', '合同', '套餐'],
    requiredInputs: ['客户需求', '服务范围', '报价规则', '折扣范围'],
    outputs: ['报价草案', '价格依据', '风险提示', '邮件草稿'],
    tools: ['quote', 'crm', 'email', 'finance'],
    riskNotes: ['正式开票、付款、超折扣和合同金额承诺必须确认。'],
    status: 'built_in'
  },
  {
    id: 'function.finance_modeling',
    type: 'function',
    displayName: '财务模型',
    summary: '做预算、成本、毛利、现金流和情景测算。',
    triggers: ['预算', '成本', '毛利', '现金流', '盈亏', '财务模型'],
    requiredInputs: ['预算', '收入假设', '成本项', '周期'],
    outputs: ['预算表', '盈亏平衡', '现金流风险', '敏感性分析'],
    tools: ['finance'],
    riskNotes: ['真实付款、退款、转账和报税必须确认。'],
    status: 'built_in'
  },
  {
    id: 'function.project_management',
    type: 'function',
    displayName: '项目管理',
    summary: '把方案拆成里程碑、任务、依赖和验收标准。',
    triggers: ['计划', '执行', '落地', '项目', '路线图', '里程碑'],
    requiredInputs: ['目标', '期限', '资源', '约束'],
    outputs: ['7 天计划', '30 天计划', '90 天计划', '验收标准'],
    tools: ['tasks', 'calendar', 'memory'],
    riskNotes: ['外部承诺和生产变更需要确认。'],
    status: 'built_in'
  },
  {
    id: 'function.compliance_check',
    type: 'function',
    displayName: '合规检查',
    summary: '识别法律、税务、医疗、投资、平台和触达合规风险。',
    triggers: ['合规', '风险', '许可', '证照', '法律', '税务', '隐私'],
    requiredInputs: ['行业', '地区', '动作类型', '外部对象'],
    outputs: ['风险清单', '确认点', '专业咨询提醒'],
    tools: ['memory', 'web_research'],
    riskNotes: ['只能给常识性风险提示，不能伪装成专业执业意见。'],
    status: 'built_in'
  },
  {
    id: 'execution.browser_research',
    type: 'execution',
    displayName: '浏览器/公开资料研究',
    summary: '为研究和客户挖掘准备搜索、截图、提取和证据保存步骤。',
    triggers: ['搜索', '官网', '公开资料', '浏览器', '截图', '提取'],
    requiredInputs: ['目标', '关键词', '允许域名', '证据格式'],
    outputs: ['搜索计划', '证据清单', '浏览器任务'],
    tools: ['browser'],
    riskNotes: ['登录态、受限平台、提交表单和付费数据源必须确认。'],
    status: 'built_in'
  }
];

const registryById = new Map(SKILL_REGISTRY.map((skill) => [skill.id, skill]));

export function listSkills(type?: SkillType) {
  return type ? SKILL_REGISTRY.filter((skill) => skill.type === type) : [...SKILL_REGISTRY];
}

export function listSkillIds(type?: SkillType) {
  return listSkills(type).map((skill) => skill.id);
}

export function getSkillDefinition(skillId: string | undefined) {
  return skillId ? registryById.get(skillId) ?? null : null;
}

export function selectSkillsForText(text: string, preferredFunctionSkillIds: string[] = []): SkillSelection {
  const normalized = text.toLowerCase();
  const selectedIndustry = listSkills('industry').filter((skill) => matchesSkill(skill, normalized));
  const selectedFunctions = listSkills('function').filter(
    (skill) => preferredFunctionSkillIds.includes(skill.id) || matchesSkill(skill, normalized)
  );
  const selectedExecutions = listSkills('execution').filter((skill) => matchesSkill(skill, normalized));
  const reasons: string[] = [];

  if (!selectedIndustry.length) {
    const fallback = getSkillDefinition('industry.saas_software_service');
    if (fallback) {
      selectedIndustry.push(fallback);
      reasons.push('未命中特定行业 Skill，先使用 SaaS / 软件服务作为通用企业服务默认行业 Skill。');
    }
  }

  for (const skillId of preferredFunctionSkillIds) {
    const skill = getSkillDefinition(skillId);
    if (skill && skill.type === 'function' && !selectedFunctions.some((item) => item.id === skill.id)) {
      selectedFunctions.push(skill);
    }
  }

  if (!selectedFunctions.length) {
    const marketResearch = getSkillDefinition('function.market_research');
    const projectManagement = getSkillDefinition('function.project_management');
    if (marketResearch) selectedFunctions.push(marketResearch);
    if (projectManagement) selectedFunctions.push(projectManagement);
    reasons.push('未命中特定职能 Skill，默认加入市场调研和项目管理。');
  }

  if (/搜索|官网|公开|挖掘|客户|线索|浏览器/i.test(text)) {
    const browserResearch = getSkillDefinition('execution.browser_research');
    if (browserResearch && !selectedExecutions.some((item) => item.id === browserResearch.id)) {
      selectedExecutions.push(browserResearch);
    }
  }

  return {
    industrySkills: dedupe(selectedIndustry),
    functionSkills: dedupe(selectedFunctions),
    executionSkills: dedupe(selectedExecutions),
    reasons
  };
}

function matchesSkill(skill: SkillDefinition, normalizedText: string) {
  return skill.triggers.some((trigger) => normalizedText.includes(trigger.toLowerCase()));
}

function dedupe(skills: SkillDefinition[]) {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (seen.has(skill.id)) return false;
    seen.add(skill.id);
    return true;
  });
}
