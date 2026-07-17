import { deliveryStrategyFromMetadata, planDeliveryStrategy, type DeliveryStrategy } from '../delivery/deliveryStrategy.js';

export type WorkExecutionMode = 'single_agent' | 'sequential_handoff' | 'parallel_then_synthesis';

export interface WorkStrategyStep {
  title: string;
  ownerAgent: string;
  description: string;
  expectedOutput: string;
}

export interface WorkStrategy {
  workflow: string;
  executionMode: WorkExecutionMode;
  leadAgent: string;
  rationale: string;
  steps: WorkStrategyStep[];
  delivery: DeliveryStrategy;
  qualityBar: string[];
}

export interface TaskPublicBrief {
  originalRequest: string;
  title: string;
  subject: string;
  audience: string;
  pageCount?: number;
  style: string;
  purpose: string;
  mustInclude: string[];
  outputLanguage: string;
  deliverableKind: string;
}

export interface TaskContract {
  version: 'v1';
  publicBrief: TaskPublicBrief;
  deliverableAgent?: {
    agentId: string;
    output: 'slide_deck_spec_json';
    prompt: string;
  };
  internalBrief: {
    executionMode: WorkExecutionMode;
    leadAgent: string;
    delivery: DeliveryStrategy;
    rationale: string;
    qualityBar: string[];
  };
}

export function createTaskContract(text: string, strategy: WorkStrategy): TaskContract {
  const publicBrief = createPublicBrief(text, strategy.delivery);
  return {
    version: 'v1',
    publicBrief,
    deliverableAgent: strategy.delivery.kind === 'presentation_deck'
      ? {
          agentId: 'content',
          output: 'slide_deck_spec_json',
          prompt: buildPresentationDeckAgentPrompt(publicBrief)
        }
      : undefined,
    internalBrief: {
      executionMode: strategy.executionMode,
      leadAgent: strategy.leadAgent,
      delivery: strategy.delivery,
      rationale: strategy.rationale,
      qualityBar: strategy.qualityBar
    }
  };
}

function buildPresentationDeckAgentPrompt(brief: TaskPublicBrief) {
  const pageCount = Math.min(Math.max(brief.pageCount ?? 10, 6), 14);
  return [
    '你是 Tele-OPC OS 的 Content Agent，现在要生成最终用户可见的 PPT 内容。',
    '',
    '这是 Chief Agent 已经整理好的交付任务契约，只能根据这里的信息写 PPT：',
    `主题：${brief.subject}`,
    `受众：${brief.audience}`,
    `页数：${pageCount}`,
    `风格：${brief.style}`,
    `语言：${brief.outputLanguage}`,
    `目标：${brief.purpose}`,
    `必须覆盖：${brief.mustInclude.join('、') || '按主题自行判断'}`,
    '',
    '你必须输出严格 JSON，不要 markdown，不要代码块，不要解释。',
    'JSON 格式：',
    '{',
    '  "title": "整套 PPT 标题",',
    '  "theme": "视觉/内容主题",',
    '  "slides": [',
    '    {',
    '      "eyebrow": "01 章节名",',
    '      "title": "本页具体观点标题",',
    '      "subtitle": "本页一句话解释",',
    '      "bullets": ["短要点1", "短要点2", "短要点3"],',
    '      "visualHint": "画面/图表建议"',
    '    }',
    '  ]',
    '}',
    '',
    '硬性要求：',
    `1. slides 数量必须等于 ${pageCount}。`,
    '2. 每页 bullets 为 3 到 4 条，每条不超过 34 个汉字。',
    '3. 页面标题必须是针对主题写出的具体观点，不要套用固定栏目。',
    '4. 禁止使用这些模板标题：核心传播结论、消费趋势、产品定位、目标人群、传播主张、内容打法、渠道打法、执行节奏、下一步建议。',
    '5. 禁止输出 Work Strategy、artifactType、deliveryStrategy、internalBrief、publicBrief、Agent 分工、任务步骤、预期产出、系统理解、领导原话。',
    '6. 不要写“当前最需要解决的障碍是什么”“为什么会犹豫”“给出结论、依据和下一步”这类提示词。',
    '7. 缺少真实数据时写“待补充真实数据”，不要编造事实。',
    '8. 最终内容应该能直接作为 PPT 页面正文展示给用户。'
  ].join('\n');
}

export function planContentWorkStrategy(text: string): WorkStrategy {
  const delivery = planDeliveryStrategy(text);

  if (delivery.kind === 'presentation_deck') {
    return {
      workflow: 'content',
      executionMode: 'sequential_handoff',
      leadAgent: 'content',
      rationale: '领导要的是一份可展示的 PPT，而不是一堆文字。系统必须先理解汇报对象、叙事目标和展示场景，再安排研究、结构、逐页内容、视觉版式和最终幻灯片预览。',
      delivery,
      steps: [
        {
          title: '分析领导原话和交付场景',
          ownerAgent: 'chief_of_staff',
          description: '提炼主题、受众、页数、风格、使用场景、缺失信息和默认假设；判断这项工作最终应该以幻灯片预览交付。',
          expectedOutput: 'PPT 任务契约：主题、受众、页数、风格、展示方式和质量标准'
        },
        {
          title: '收集资料并形成观点假设',
          ownerAgent: 'research',
          description: '围绕主题整理背景、目标受众、关键事实、可用资料、证据缺口和不能伪造的数据。',
          expectedOutput: '研究摘要、关键判断、证据缺口和假设边界'
        },
        {
          title: '设计叙事结构和页序',
          ownerAgent: 'content',
          description: '确定封面、结论、背景、问题、洞察、方案、计划、风险和下一步的顺序，让每页只服务一个结论。',
          expectedOutput: '逐页大纲、每页目的和逻辑承接'
        },
        {
          title: '生成逐页内容和讲稿提示',
          ownerAgent: 'content',
          description: '生成每页标题、核心观点、正文要点、图表建议和讲稿提示，避免把长文堆进页面。',
          expectedOutput: '10-12 页 slide content v0'
        },
        {
          title: '设计视觉版式和组件表达',
          ownerAgent: 'content',
          description: '选择适合主题的色彩、版式、图表、重点页样式和移动端预览规则。',
          expectedOutput: '版式规范、视觉方向和每页布局建议'
        },
        {
          title: '生成可预览幻灯片交付物',
          ownerAgent: 'content',
          description: '把前面步骤合成为 slide deck HTML artifact，在 Telegram Mini App 或 Web Console 中预览。',
          expectedOutput: '可预览 slide deck artifact，而不是 Telegram 长文本'
        }
      ],
      qualityBar: [
        '任务开头必须先写清领导原话被理解成什么工作。',
        '每页只表达一个核心结论，正文不能堆成长文章。',
        '缺失的数据必须标记为假设或待验证。',
        '最终交付必须有可预览幻灯片 artifact 和任务执行链。'
      ]
    };
  }

  if (delivery.kind === 'html_page') {
    return {
      workflow: 'content',
      executionMode: 'sequential_handoff',
      leadAgent: 'content',
      rationale: '这是网页型交付，不能只写文案或丢代码；需要先定义目标和信息架构，再由 Dev Agent 生成可预览页面，最后做体验检查。',
      delivery,
      steps: [
        {
          title: '定义网页目标、用户和成功标准',
          ownerAgent: 'content',
          description: '明确网页服务对象、核心卖点、首屏信息、必须出现的模块和完成标准。',
          expectedOutput: '网页 brief、受众、模块清单和成功标准'
        },
        {
          title: '设计信息架构、文案和视觉方向',
          ownerAgent: 'content',
          description: '生成页面叙事、区块顺序、标题、正文、CTA、视觉风格和交互建议。',
          expectedOutput: '页面结构、完整文案、视觉方向和组件说明'
        },
        {
          title: '实现可预览页面代码',
          ownerAgent: 'dev',
          description: '把文案和结构转成可独立预览的 HTML/CSS/JS 交付物。',
          expectedOutput: '可预览网页 artifact，而不是 Telegram 长代码消息'
        },
        {
          title: '检查移动端预览和交付方式',
          ownerAgent: 'content',
          description: '检查 Telegram Mini App 阅读体验、按钮、文案层级、移动端排版和下一步交付说明。',
          expectedOutput: 'QA 摘要、预览入口和可继续迭代的修改建议'
        }
      ],
      qualityBar: [
        '手机端首屏能看懂这是什么、给谁用、下一步做什么。',
        '代码作为 artifact 交付，不直接刷满 Telegram。',
        '页面能在 Telegram Mini App 半屏或全屏容器里阅读。',
        '说明由哪些 Agent 参与，每个 Agent 产出了什么。'
      ]
    };
  }

  if (delivery.kind === 'code_or_markup') {
    return {
      workflow: 'content',
      executionMode: 'sequential_handoff',
      leadAgent: 'dev',
      rationale: '这是代码型交付，需要需求、实现、审阅和预览/复制入口，而不是聊天里直接贴长代码。',
      delivery,
      steps: [
        {
          title: '整理代码需求和验收标准',
          ownerAgent: 'dev',
          description: '明确运行环境、输入输出、文件形态、验收标准和风险边界。',
          expectedOutput: '实现 spec 和验收清单'
        },
        {
          title: '生成代码实现和使用说明',
          ownerAgent: 'dev',
          description: '生成代码 artifact、关键说明、运行方式和限制。',
          expectedOutput: '代码 artifact、使用说明和注意事项'
        },
        {
          title: '审阅代码并准备交付入口',
          ownerAgent: 'dev',
          description: '做可读性、完整性和风险检查；给出 Web Console/Mini App 预览或下载入口。',
          expectedOutput: '审阅摘要、交付入口和下一步修改建议'
        }
      ],
      qualityBar: [
        'Telegram 只显示摘要和按钮。',
        '代码保留格式、文件名和复制入口。',
        '明确执行该代码的 Agent 和模型。'
      ]
    };
  }

  if (delivery.kind === 'long_document') {
    return {
      workflow: 'content',
      executionMode: 'sequential_handoff',
      leadAgent: 'content',
      rationale: '这是长文档交付，需要先定结构，再写正文，最后进入阅读容器。',
      delivery,
      steps: [
        {
          title: '定义文档目标、读者和结构',
          ownerAgent: 'content',
          description: '明确读者、结论、章节、证据和语气。',
          expectedOutput: '文档大纲和写作标准'
        },
        {
          title: '生成正文草稿和可复用段落',
          ownerAgent: 'content',
          description: '生成完整正文、摘要、标题和重点段落。',
          expectedOutput: '长文档 artifact'
        },
        {
          title: '编辑校对并生成阅读入口',
          ownerAgent: 'content',
          description: '检查逻辑、重复、事实风险和阅读体验。',
          expectedOutput: '预览入口、摘要和修改建议'
        }
      ],
      qualityBar: [
        '长内容进入阅读容器。',
        'Telegram 只保留摘要、目录和按钮。',
        '缺少证据的判断要标记为假设。'
      ]
    };
  }

  return {
    workflow: 'content',
    executionMode: delivery.kind === 'short_copy' ? 'single_agent' : 'sequential_handoff',
    leadAgent: 'content',
    rationale: '这是普通内容工作，重点是先理解目标，再生成草稿和检查发布风险。',
    delivery,
    steps: [
      {
        title: '明确目标受众和渠道',
        ownerAgent: 'content',
        description: '提炼受众、平台、语气、转化目标和限制条件。',
        expectedOutput: '内容 brief'
      },
      {
        title: '生成内容草稿和备选标题',
        ownerAgent: 'content',
        description: '生成文案、脚本、标题、开头和 CTA。',
        expectedOutput: '内容草稿'
      },
      {
        title: '准备发布计划和风险检查',
        ownerAgent: 'content',
        description: '给出发布时间、复用方式、敏感点和需要确认的发布动作。',
        expectedOutput: '发布建议和风险清单'
      }
    ],
    qualityBar: [
      '草稿符合目标渠道。',
      '公开发布、广告投放和非邮件外部动作需要确认。',
      'Telegram 能直接读懂摘要。'
    ]
  };
}

export function workStrategyFromMetadata(metadata: Record<string, unknown> | null | undefined): WorkStrategy | null {
  const raw = metadata?.workStrategy;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const delivery = deliveryStrategyFromMetadata({ deliveryStrategy: record.delivery });
  if (
    !delivery
    || typeof record.workflow !== 'string'
    || typeof record.executionMode !== 'string'
    || typeof record.leadAgent !== 'string'
    || typeof record.rationale !== 'string'
    || !Array.isArray(record.steps)
    || !Array.isArray(record.qualityBar)
  ) {
    return null;
  }
  return {
    workflow: record.workflow,
    executionMode: record.executionMode as WorkExecutionMode,
    leadAgent: record.leadAgent,
    rationale: record.rationale,
    delivery,
    steps: record.steps.filter(isWorkStrategyStep),
    qualityBar: record.qualityBar.filter((item): item is string => typeof item === 'string')
  };
}

function isWorkStrategyStep(value: unknown): value is WorkStrategyStep {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.title === 'string'
    && typeof record.ownerAgent === 'string'
    && typeof record.description === 'string'
    && typeof record.expectedOutput === 'string';
}

function createPublicBrief(text: string, delivery: DeliveryStrategy): TaskPublicBrief {
  const explicitSubject = extractField(text, /(?:主题|题目|topic|subject)[：:\s]*([^，,。；;\n]{2,80})/i);
  const cleaned = cleanRequestText(explicitSubject || text);
  const pageCount = extractPageCount(text);
  const audience = extractField(text, /面向([^，,。；;\n]{1,12})的/i)
    || extractField(text, /(?:受众|给|for)[：:\s]*([^，,。；;\n]{2,28})/i)
    || (/团队|内部/.test(text) ? '团队内部' : '目标听众');
  const style = extractField(text, /(?:风格|style)[：:\s]*([^，,。；;\n]{2,18})/i)
    || (/科技|tech/i.test(text) ? '科技感' : '简洁商务');
  const title = cleaned.length > 42 ? `${cleaned.slice(0, 42)}...` : cleaned;

  return {
    originalRequest: cleaned || delivery.title,
    title: title || delivery.title,
    subject: cleaned || delivery.title,
    audience,
    pageCount,
    style,
    purpose: purposeFor(delivery.kind),
    mustInclude: mustIncludeFor(delivery.kind),
    outputLanguage: /英文|English/i.test(text) ? '英文' : '中文',
    deliverableKind: delivery.kind
  };
}

function cleanRequestText(text: string) {
  return text
    .replace(/^V3\s*幻灯片交付任务[：:]/i, '')
    .replace(/^PPT[：:]/i, '')
    .replace(/^请生成一份可预览的\s*/i, '')
    .replace(/主题[：:]/gi, ' ')
    .replace(/帮我|请|给我|写一个|做一个|生成|制作|PPT|ppt|幻灯片|演示文稿|presentation|slide deck|slides/gi, ' ')
    .replace(/由合适的\s*AI\s*Agent\s*团队拆解执行/gi, ' ')
    .replace(/并由合适的\s*AI\s*Agent\s*团队拆解执行/gi, ' ')
    .replace(/页数[：:]?\s*\d{1,2}\s*页?/gi, ' ')
    .replace(/\d{1,2}\s*页/gi, ' ')
    .replace(/风格[：:]?\s*[^，,。；;\n]+/gi, ' ')
    .replace(/(?:商务风|科技风|简洁风|咨询风|路演风)/gi, ' ')
    .replace(/受众[：:]?\s*[^，,。；;\n]+/gi, ' ')
    .replace(/面向([^，,。；;\n]{1,12})的/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。；;：:\s]+|[，,。；;：:\s]+$/g, '')
    .trim();
}

function extractPageCount(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:页|p|P|slides?)/i);
  return match ? Number(match[1]) : undefined;
}

function extractField(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? '';
}

function purposeFor(kind: string) {
  if (kind === 'presentation_deck') return '让听众快速理解主题、核心价值、落地路径和下一步决策。';
  if (kind === 'html_page') return '让访问者快速理解对象、价值和下一步行动。';
  if (kind === 'code_or_markup') return '交付可审阅、可复制、可运行的代码成果。';
  return '交付清晰、可复用、可继续迭代的内容成果。';
}

function mustIncludeFor(kind: string) {
  if (kind === 'presentation_deck') return ['封面', '结论先行', '背景问题', '方案路径', '执行计划', '风险边界', '下一步'];
  if (kind === 'html_page') return ['首屏定位', '核心价值', '能力模块', '工作流', '行动入口'];
  if (kind === 'code_or_markup') return ['文件结构', '核心代码', '运行方式', '限制说明'];
  return ['摘要', '主体内容', '风险或假设', '下一步'];
}
