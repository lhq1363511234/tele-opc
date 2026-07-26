export interface PlannedStep {
  title: string;
  description: string;
  ownerAgent: string;
}

export interface TaskPlan {
  goal: string;
  reasons: string[];
  steps: PlannedStep[];
}

const plannerSignals = /规划|计划|拆解|流程|项目|方案|路线|roadmap|plan|decompose/i;

export function createTaskPlan(text: string): TaskPlan | null {
  const normalizedText = text.trim();
  if (!normalizedText) return null;

  const explicitSteps = stepsFromDelimitedRequest(normalizedText);
  if (explicitSteps.length >= 2) {
    return {
      goal: normalizedText.slice(0, 120),
      reasons: ['request contains multiple explicit steps'],
      steps: explicitSteps
    };
  }

  if (!plannerSignals.test(normalizedText)) return null;

  const domainSteps = stepsFromDomains(normalizedText);
  if (domainSteps.length >= 2) {
    return {
      goal: normalizedText.slice(0, 120),
      reasons: ['request mentions multiple operating domains'],
      steps: domainSteps
    };
  }

  return {
    goal: normalizedText.slice(0, 120),
    reasons: ['request asks for planning or decomposition'],
    steps: [
      {
        title: '澄清目标和成功标准',
        description: '明确这项工作的目标、产出格式、完成标准和风险边界。',
        ownerAgent: 'chief_of_staff'
      },
      {
        title: '收集相关上下文和公司记忆',
        description: '读取已有任务、公司记忆和相关业务背景，避免重复确认。',
        ownerAgent: 'chief_of_staff'
      },
      {
        title: '拆解执行步骤和依赖关系',
        description: '把目标拆成可以排队、审批和追踪的子任务。',
        ownerAgent: 'chief_of_staff'
      },
      {
        title: '标记需要审批的高风险动作',
        description: '识别财务、非邮件批量触达、日历外部邀请、浏览器提交等需要审批的动作。',
        ownerAgent: 'chief_of_staff'
      }
    ]
  };
}

/**
 * Only treats a request as an explicit step list when the user actually wrote
 * one (numbered markers or bullet lines). Splitting arbitrary prose on commas
 * shredded real goals into meaningless fragments like "付多少".
 */
function stepsFromDelimitedRequest(text: string) {
  const numbered = text.match(/(?:^|\n)\s*(?:\d+[.、)）]|[-*•])\s*[^\n]{4,}/g);
  if (!numbered || numbered.length < 2) return [];

  return numbered
    .map((part) => part.replace(/^\s*(?:\d+[.、)）]|[-*•])\s*/, '').trim())
    .filter((part) => part.length >= 4)
    .slice(0, 8)
    .map((part) => ({
      title: normalizeStepTitle(part),
      description: `来自用户规划请求的步骤：${part}`,
      ownerAgent: ownerAgentFor(part)
    }));
}

function stepsFromDomains(text: string) {
  const steps: PlannedStep[] = [];


  if (/数字自我|分身|记忆|决策|OPC运行/i.test(text)) {
    steps.push({
      title: '调用 A- 数字自我引擎',
      description: '读取 A- 的画像、长短期记忆和权限设定，根据决策日志给出当前选择及后续规则建议。',
      ownerAgent: 'chief_of_staff'
    });
  }
  if (/客户|CRM|线索|销售|跟进/i.test(text)) {
    steps.push({
      title: /挖掘|获客|找客户|prospect/i.test(text) ? '定义 ICP 并制定客户挖掘策略' : '整理客户和线索上下文',
      description: /挖掘|获客|找客户|prospect/i.test(text)
        ? '定义目标客户画像、公开线索来源、评分模型、触达草稿和 CRM 写入计划。'
        : '梳理相关客户、线索、互动记录和下一步跟进机会。',
      ownerAgent: /挖掘|获客|找客户|prospect/i.test(text) ? 'prospecting' : 'crm'
    });
  }

  if (/行业|市场|竞品|方案|评估|能不能做|定位|商业模式/i.test(text)) {
    steps.push({
      title: '调用行业 Skill 生成结构化方案',
      description: '识别行业和职能 Skill，形成问题重述、假设、证据计划、方案选项、风险和执行计划。',
      ownerAgent: 'solution'
    });
  }

  if (/报价|定价|价格|服务包|套餐/i.test(text)) {
    steps.push({
      title: '生成报价草案和价格依据',
      description: '根据报价规则、服务包、历史报价和合同条款生成草案；真实开票和财务承诺进入确认。',
      ownerAgent: 'quote'
    });
  }

  if (/开发|代码|bug|修复|部署|Claude Code|仓库|测试/i.test(text)) {
    steps.push({
      title: '交给 Dev Agent Team 处理开发任务',
      description: '整理 spec、repo context、实现计划、测试和 review；生产部署或破坏性命令进入确认。',
      ownerAgent: 'dev'
    });
  }

  if (/邮件|email|收件箱|回复/i.test(text)) {
    steps.push({
      title: '起草邮件或跟进回复',
      description: '根据上下文和公司记忆准备邮件草稿；Campaign 邮件可由发送器自动发送，财务、表单、发布等高风险动作另行确认。',
      ownerAgent: 'email'
    });
  }

  if (/财务|现金流|发票|订阅|付款|退款/i.test(text)) {
    steps.push({
      title: '整理财务风险和现金流信息',
      description: '汇总收入、支出、发票、订阅和需要审批的财务动作。',
      ownerAgent: 'finance'
    });
  }

  if (/日历|会议|时间|安排|calendar/i.test(text)) {
    steps.push({
      title: '检查日程并准备会议动作',
      description: '查看会议、冲突、空闲时间和外部邀请审批需求。',
      ownerAgent: 'calendar'
    });
  }

  if (/浏览器|网页|后台|Stripe|GitHub|自动化|browser/i.test(text)) {
    steps.push({
      title: '准备浏览器自动化巡检',
      description: '确认允许访问的域名、需要截图的证据和提交前审批点。',
      ownerAgent: 'browser'
    });
  }

  if (/内容|发布|营销|文章|社媒/i.test(text)) {
    steps.push({
      title: '准备内容草稿和发布审批',
      description: '起草内容计划，公开发布前进入审批。',
      ownerAgent: 'content'
    });
  }

  return steps.slice(0, 8);
}

function normalizeStepTitle(text: string) {
  const cleaned = text.replace(/^(先|然后|再|最后|并且|以及)\s*/, '').trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function ownerAgentFor(text: string) {
  if (/挖掘|获客|找客户|prospect/i.test(text)) return 'prospecting';
  if (/行业|市场|竞品|方案|评估|能不能做|定位|商业模式/i.test(text)) return 'solution';
  if (/报价|定价|价格|服务包|套餐/i.test(text)) return 'quote';
  if (/开发|代码|bug|修复|部署|Claude Code|仓库|测试/i.test(text)) return 'dev';
  if (/邮件|email|收件箱|回复/i.test(text)) return 'email';
  if (/客户|CRM|线索|销售|跟进/i.test(text)) return 'crm';
  if (/财务|现金流|发票|订阅|付款|退款/i.test(text)) return 'finance';
  if (/日历|会议|时间|安排|calendar/i.test(text)) return 'calendar';
  if (/浏览器|网页|后台|Stripe|GitHub|自动化|browser/i.test(text)) return 'browser';
  if (/内容|发布|营销|文章|社媒/i.test(text)) return 'content';
  return 'chief_of_staff';
}
