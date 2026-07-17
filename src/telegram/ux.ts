import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import type { ApprovalRecord, PendingApprovalRecord, TaskRecord, TaskStatus } from '../types.js';
import type { TelegramInlineKeyboardMarkup } from './client.js';
import type { TelegramDocument, TelegramMessage, TelegramPhotoSize, TelegramVoice } from './types.js';

const RETRYABLE_STATUSES: TaskStatus[] = ['failed', 'blocked', 'waiting_external', 'planned'];
const ACTIVE_STATUSES: TaskStatus[] = [
  'new',
  'intake',
  'planned',
  'waiting_approval',
  'queued',
  'running',
  'waiting_external',
  'blocked',
  'review',
  'failed'
];

type CallbackAction =
  | { kind: 'task'; action: 'view' | 'retry' | 'continue' | 'pause' | 'cancel'; id: string }
  | { kind: 'approval'; action: 'approve' | 'reject' | 'view'; id: string }
  | { kind: 'nav'; action: 'tasks' | 'approvals' | 'new' }
  | { kind: 'new'; action: 'ppt' | 'crm' | 'mail' | 'finance' | 'agent' }
  | { kind: 'quick_new'; action: 'ppt' | 'crm' | 'mail' | 'finance' | 'agent' };

export interface TelegramCard {
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export function parseTelegramCallbackData(data?: string): CallbackAction | null {
  if (!data) return null;
  const [scope, action, ...rest] = data.split(':');
  const id = rest.join(':');

  if (scope === 't' && id) {
    if (action === 'v') return { kind: 'task', action: 'view', id };
    if (action === 'r') return { kind: 'task', action: 'retry', id };
    if (action === 'c') return { kind: 'task', action: 'continue', id };
    if (action === 'p') return { kind: 'task', action: 'pause', id };
    if (action === 'x') return { kind: 'task', action: 'cancel', id };
  }

  if (scope === 'a' && id) {
    if (action === 'y') return { kind: 'approval', action: 'approve', id };
    if (action === 'n') return { kind: 'approval', action: 'reject', id };
    if (action === 'v') return { kind: 'approval', action: 'view', id };
  }

  if (scope === 'nav') {
    if (action === 'tasks') return { kind: 'nav', action: 'tasks' };
    if (action === 'approvals') return { kind: 'nav', action: 'approvals' };
    if (action === 'new') return { kind: 'nav', action: 'new' };
  }

  if (scope === 'new') {
    if (['ppt', 'crm', 'mail', 'finance', 'agent'].includes(action)) {
      return { kind: 'new', action: action as CallbackAction extends { kind: 'new'; action: infer A } ? A : never };
    }
  }

  if (scope === 'nq') {
    if (['ppt', 'crm', 'mail', 'finance', 'agent'].includes(action)) {
      return { kind: 'quick_new', action: action as CallbackAction extends { kind: 'quick_new'; action: infer A } ? A : never };
    }
  }

  return null;
}

export async function resolveTaskReference(repos: Repositories, reference: string) {
  const normalized = normalizeReference(reference);
  if (!normalized) return null;
  if (normalized.startsWith('tsk_')) return repos.getTask(normalized);

  const tasks = await repos.listTasks(100);
  const numericIndex = Number(normalized);
  if (Number.isInteger(numericIndex) && numericIndex > 0) {
    return tasks[numericIndex - 1] ?? null;
  }

  return tasks.find((task) => taskCode(task.id).toLowerCase() === normalized.toLowerCase()) ?? null;
}

export async function resolveApprovalReference(repos: Repositories, reference: string) {
  const normalized = normalizeReference(reference);
  if (!normalized) return null;
  if (normalized.startsWith('apv_')) return repos.getApproval(normalized);

  const approvals = await repos.listPendingApprovals(100);
  const numericIndex = Number(normalized);
  if (Number.isInteger(numericIndex) && numericIndex > 0) {
    return approvals[numericIndex - 1] ?? null;
  }

  return approvals.find((approval) => approvalCode(approval.id).toLowerCase() === normalized.toLowerCase()) ?? null;
}

export function shouldHandleAsTelegramTaskCommand(text?: string) {
  const command = firstCommand(text);
  return command ? ['/start', '/help', '/tasks', '/task', '/next', '/new', '/approvals', '/approve', '/reject', '/retry'].includes(command) : false;
}

export function firstCommand(text?: string) {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith('/')) return null;
  return trimmed.split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();
}

export function commandArg(text?: string) {
  const trimmed = text?.trim() ?? '';
  return trimmed.replace(/^\/[a-zA-Z0-9_]+(?:@\w+)?\s*/, '').trim();
}

export function buildTaskListCard(tasks: TaskRecord[], config: AppConfig, title = '当前任务'): TelegramCard {
  const activeTasks = tasks
    .filter((task) => task.parent_task_id === null)
    .filter((task) => ACTIVE_STATUSES.includes(task.status))
    .slice(0, 8);
  if (!activeTasks.length) {
    return {
      text: [
        `${title}`,
        '',
        '暂无进行中的任务。',
        '你可以直接发一句自然语言目标，或点下面的新建任务。'
      ].join('\n'),
      replyMarkup: {
        inline_keyboard: [
          [{ text: '新建任务', callback_data: 'nav:new' }],
          [webAppButton('打开控制台', config, '/app/tasks')]
        ]
      }
    };
  }

  const lines = [
    `${title}`,
    '',
    ...activeTasks.map((task, index) => {
      const progress = task.sequence ? ` #${task.sequence}` : '';
      return `${index + 1}. ${taskCode(task.id)} ${statusLabel(task.status)} ${truncate(task.title, 26)}${progress}`;
    }),
    '',
    '点任务按钮查看详情；也可以回复列表序号。'
  ];

  const inline_keyboard: TelegramInlineKeyboardMarkup['inline_keyboard'] = activeTasks.map((task, index) => {
    const row = [{ text: `${index + 1} ${taskCode(task.id)} 详情`, callback_data: callbackData('t', 'v', task.id) }];
    const primary = taskPrimaryButton(task);
    if (primary) row.push(primary);
    return row;
  });

  inline_keyboard.push([
    { text: '下一步', callback_data: 'nav:tasks' },
    { text: '新建任务', callback_data: 'nav:new' }
  ]);
  inline_keyboard.push([webAppButton('打开任务面板', config, '/app/tasks')]);

  return {
    text: lines.join('\n'),
    replyMarkup: { inline_keyboard }
  };
}

export function buildTaskDetailCard(
  task: TaskRecord,
  subtasks: TaskRecord[],
  config: AppConfig,
  extraLines: string[] = []
): TelegramCard {
  const doneCount = subtasks.filter((subtask) => subtask.status === 'done').length;
  const subtaskSummary = subtasks.length ? `${doneCount}/${subtasks.length}` : '无';
  const currentStep = subtasks.find((subtask) => !['done', 'cancelled'].includes(subtask.status));
  const lines = [
    `任务 ${taskCode(task.id)}`,
    '',
    `标题：${task.title}`,
    `状态：${statusLabel(task.status)}`,
    `负责人：${task.owner_agent}`,
    `风险：${riskLabel(task.risk_level)}`,
    `子任务：${subtaskSummary}`,
    currentStep ? `当前步骤：${taskCode(currentStep.id)} ${statusLabel(currentStep.status)} ${truncate(currentStep.title, 36)}` : '',
    task.description ? `说明：${truncate(task.description, 160)}` : '',
    ...extraLines,
    '',
    `下一步：${nextActionLabel(task)}`
  ].filter(Boolean);

  if (subtasks.length) {
    lines.push('', '子任务');
    lines.push(
      ...subtasks.slice(0, 8).map((subtask, index) =>
        `${index + 1}. ${taskCode(subtask.id)} ${statusLabel(subtask.status)} ${truncate(subtask.title, 30)}`
      )
    );
  }

  return {
    text: lines.join('\n'),
    replyMarkup: {
      inline_keyboard: taskDetailKeyboard(task, subtasks, config)
    }
  };
}

export function buildApprovalListCard(approvals: PendingApprovalRecord[], config: AppConfig): TelegramCard {
  if (!approvals.length) {
    return {
      text: '当前没有待审批事项。',
      replyMarkup: {
        inline_keyboard: [
          [{ text: '查看任务', callback_data: 'nav:tasks' }],
          [webAppButton('打开财务审批面板', config, '/app/finance?panel=approvals')]
        ]
      }
    };
  }

  return {
    text: [
      '待审批',
      '',
      ...approvals.slice(0, 8).map((approval, index) =>
        `${index + 1}. ${approvalCode(approval.id)} ${riskLabel(approval.risk_level)} ${truncate(approval.prompt, 44)}`
      )
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        ...approvals.slice(0, 8).map((approval, index) => [
          { text: `${index + 1} 查看`, callback_data: callbackData('a', 'v', approval.id) },
          { text: '批准', callback_data: callbackData('a', 'y', approval.id) },
          { text: '拒绝', callback_data: callbackData('a', 'n', approval.id) }
        ]),
        [webAppButton('打开财务审批面板', config, '/app/finance?panel=approvals')]
      ]
    }
  };
}

export function buildApprovalCard(approval: ApprovalRecord | PendingApprovalRecord, config: AppConfig): TelegramCard {
  return {
    text: [
      `审批 ${approvalCode(approval.id)}`,
      '',
      `状态：${approval.status}`,
      `风险：${riskLabel(approval.risk_level)}`,
      `类型：${approval.action_type}`,
      approval.task_id ? `关联任务：${taskCode(approval.task_id)}` : '',
      '',
      truncate(approval.prompt, 500)
    ].filter(Boolean).join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '批准', callback_data: callbackData('a', 'y', approval.id) },
          { text: '拒绝', callback_data: callbackData('a', 'n', approval.id) }
        ],
        [webAppButton('打开审批面板', config, '/app/finance?panel=approvals')]
      ]
    }
  };
}

export function buildNewTaskMenu(config: AppConfig): TelegramCard {
  return {
    text: [
      '新建任务',
      '',
      '你可以直接发自然语言目标，也可以先选择一个任务面板。',
      '',
      '信息不完整时，我会先按默认假设推进 v0；只有财务、付款、对外承诺和高风险动作会停下来等你确认。'
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          webAppButton('PPT 引导', config, '/app/mini/ppt'),
          webAppButton('CRM 导入', config, '/app/mini/crm')
        ],
        [
          webAppButton('邮件编辑', config, '/app/mini/mail'),
          webAppButton('财务动作', config, '/app/mini/finance')
        ],
        [
          webAppButton('Agent 设置', config, '/app/mini/agent'),
          { text: '任务列表', callback_data: 'nav:tasks' }
        ],
        [
          webAppButton('PPT 引导生成', config, '/app/mini/ppt'),
          { text: 'CRM v0', callback_data: 'nq:crm' },
          { text: '邮件 v0', callback_data: 'nq:mail' }
        ],
        [webAppButton('打开完整 Mini App', config, '/app/mini')],
        [webAppButton('Mini App 诊断', config, '/app/debug/telegram')],
        [urlButton('备用浏览器打开控制台', config, '/app')]
      ]
    }
  };
}

export function buildHelpCard(config: AppConfig): TelegramCard {
  return {
    text: [
      'Tele-OPC 使用方式',
      '',
      '你不需要记命令。直接发目标即可，例如：',
      '写一个 AI Agent OS 的 PPT',
      '帮我挖掘深圳轻食品牌客户',
      '整理这张表格里的线索',
      '',
      '常用入口：',
      '/new 新建任务',
      '/tasks 当前任务',
      '/next 下一步',
      '/approvals 待审批'
    ].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '新建任务', callback_data: 'nav:new' },
          { text: '当前任务', callback_data: 'nav:tasks' }
        ],
        [
          { text: '待审批', callback_data: 'nav:approvals' },
          webAppButton('打开控制台', config, '/app')
        ]
      ]
    }
  };
}

export function buildMiniAppPanelCard(action: 'ppt' | 'crm' | 'mail' | 'finance' | 'agent', config: AppConfig): TelegramCard {
  const panels = {
    ppt: {
      title: 'PPT 引导生成',
      desc: '一步一步确认主题、受众、用途、页数、风格和素材，再生成可预览 PPT 任务。',
      path: '/app/mini/ppt'
    },
    crm: {
      title: 'CRM 导入面板',
      desc: '用于导入线索表、客户名单、行业名单和跟进计划。',
      path: '/app/mini/crm'
    },
    mail: {
      title: '邮件编辑面板',
      desc: '用于编辑邮件草稿、客户跟进和 Campaign 邮件。',
      path: '/app/mini/mail'
    },
    finance: {
      title: '财务审批面板',
      desc: '用于查看付款、报价、发票、订阅和高风险财务动作。',
      path: '/app/mini/finance'
    },
    agent: {
      title: 'Agent 设置面板',
      desc: '用于配置 AI Provider、权限策略、Agent 编排和知识库。',
      path: '/app/mini/agent'
    }
  } satisfies Record<typeof action, { title: string; desc: string; path: string }>;
  const panel = panels[action];

  return {
    text: [panel.title, '', panel.desc].join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [webAppButton(`打开${panel.title}`, config, panel.path)],
        [
          action === 'finance'
            ? { text: '查看待审批', callback_data: 'nav:approvals' }
            : { text: '不用面板，直接创建 v0 任务', callback_data: `nq:${action}` }
        ],
        [webAppButton('Mini App 诊断', config, '/app/debug/telegram')],
        [urlButton('备用浏览器打开', config, panel.path)],
        [{ text: '返回新建任务', callback_data: 'nav:new' }]
      ]
    }
  };
}

export function buildAttachmentCard(message: TelegramMessage, config: AppConfig, artifactId?: string, task?: TaskRecord): TelegramCard {
  const doc = message.document;
  const voice = message.voice;
  const photo = largestPhoto(message.photo);
  const title = doc?.file_name ?? (voice ? '语音消息' : photo ? '图片/截图' : '附件');
  const kind = classifyAttachment(message);

  const lines = [
    '已收到附件',
    '',
    `名称：${title}`,
    `类型：${attachmentKindLabel(kind)}`,
    task ? `任务：${taskCode(task.id)}` : '',
    artifactId ? `记录：${artifactId}` : '',
    '',
    attachmentNextStep(kind)
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    replyMarkup: {
      inline_keyboard: attachmentKeyboard(kind, config, task)
    }
  };
}

export function classifyAttachment(message: TelegramMessage) {
  const fileName = message.document?.file_name?.toLowerCase() ?? '';
  const mime = message.document?.mime_type?.toLowerCase() ?? message.voice?.mime_type?.toLowerCase() ?? '';
  if (message.voice) return 'voice';
  if (message.photo?.length) return 'image';
  if (/\.(csv|xlsx?|ods)$/.test(fileName) || /spreadsheet|csv|excel/.test(mime)) return 'spreadsheet';
  if (/\.(pdf|docx?|pptx?|txt|md)$/.test(fileName) || /pdf|word|presentation|text/.test(mime)) return 'knowledge_file';
  return 'file';
}

export function taskCode(id: string) {
  return shortCode('T', id);
}

export function approvalCode(id: string) {
  return shortCode('A', id);
}

export function statusLabel(status: TaskStatus) {
  const labels: Record<TaskStatus, string> = {
    new: '新建',
    intake: '已接收',
    planned: '已规划',
    waiting_approval: '等审批',
    queued: '排队中',
    running: '执行中',
    waiting_external: '等外部',
    blocked: '已阻塞',
    review: '待复盘',
    done: '已完成',
    cancelled: '已取消',
    failed: '失败'
  };
  return labels[status] ?? status;
}

function normalizeReference(reference: string) {
  return reference.trim().replace(/^#/, '').replace(/^任务/, '').replace(/^审批/, '');
}

function shortCode(prefix: string, id: string) {
  const body = id.replace(/^[a-z]+_/, '').replace(/[^a-zA-Z0-9]/g, '');
  const compact = body.length <= 4 ? body : body.slice(0, 4);
  return `${prefix}${compact.toUpperCase()}`;
}

function taskPrimaryButton(task: TaskRecord) {
  if (task.status === 'failed') {
    return { text: '重试', callback_data: callbackData('t', 'r', task.id) };
  }
  if (RETRYABLE_STATUSES.includes(task.status)) {
    return { text: '继续', callback_data: callbackData('t', 'c', task.id) };
  }
  if (task.status === 'waiting_approval') {
    return { text: '看审批', callback_data: 'nav:approvals' };
  }
  return { text: '刷新', callback_data: callbackData('t', 'v', task.id) };
}

function taskDetailKeyboard(task: TaskRecord, subtasks: TaskRecord[], config: AppConfig): TelegramInlineKeyboardMarkup['inline_keyboard'] {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  const artifactId = extractArtifactId([
    task.result ?? '',
    JSON.stringify(task.planning_metadata ?? {}),
    ...subtasks.flatMap((subtask) => [
      subtask.result ?? '',
      JSON.stringify(subtask.planning_metadata ?? {})
    ])
  ].join('\n'));
  if (artifactId) {
    rows.push([webAppButton('打开交付预览', config, `/app/deliverables/${encodeURIComponent(artifactId)}`)]);
  }
  if (RETRYABLE_STATUSES.includes(task.status)) {
    rows.push([
      { text: '继续执行', callback_data: callbackData('t', 'c', task.id) },
      { text: '重试', callback_data: callbackData('t', 'r', task.id) }
    ]);
  } else {
    rows.push([{ text: '刷新状态', callback_data: callbackData('t', 'v', task.id) }]);
  }

  if (!['done', 'cancelled'].includes(task.status)) {
    rows.push([
      { text: '暂停', callback_data: callbackData('t', 'p', task.id) },
      { text: '取消', callback_data: callbackData('t', 'x', task.id) }
    ]);
  }

  rows.push([
    { text: '返回任务列表', callback_data: 'nav:tasks' },
    webAppButton('打开控制台', config, `/app/tasks?task=${encodeURIComponent(task.id)}`)
  ]);
  return rows;
}

function extractArtifactId(text: string) {
  return text.match(/art_[a-z0-9-]+/i)?.[0] ?? null;
}

function attachmentKeyboard(kind: ReturnType<typeof classifyAttachment>, config: AppConfig, task?: TaskRecord): TelegramInlineKeyboardMarkup['inline_keyboard'] {
  const taskRow = task ? [[{ text: '查看任务', callback_data: callbackData('t', 'v', task.id) }]] : [];
  if (kind === 'spreadsheet') {
    return [
      ...taskRow,
      [
        webAppButton('导入 CRM', config, '/app/mini/crm'),
        webAppButton('导入财务', config, '/app/mini/finance-import')
      ],
      [webAppButton('打开控制台', config, '/app')]
    ];
  }
  if (kind === 'image') {
    return [
      ...taskRow,
      [
        webAppButton('截图分析', config, '/app/mini/screenshot'),
        webAppButton('作为资料', config, '/app/mini/artifact')
      ]
    ];
  }
  if (kind === 'voice') {
    return [
      ...taskRow,
      [
        webAppButton('语音转任务', config, '/app/mini/voice'),
        { text: '当前任务', callback_data: 'nav:tasks' }
      ]
    ];
  }
  return [
    ...taskRow,
    [
      webAppButton('导入知识库', config, '/app/mini/knowledge'),
      webAppButton('作为任务资料', config, '/app/mini/artifact')
    ]
  ];
}

function webAppButton(text: string, config: AppConfig, path: string) {
  return {
    text,
    web_app: {
      url: webUrl(config, path)
    }
  };
}

function urlButton(text: string, config: AppConfig, path: string) {
  return {
    text,
    url: webUrl(config, path)
  };
}

function webUrl(config: AppConfig, path: string) {
  const url = new URL(path, config.app.publicBaseUrl);
  return url.toString();
}

function callbackData(scope: string, action: string, id: string) {
  return `${scope}:${action}:${id}`;
}

function nextActionLabel(task: TaskRecord) {
  if (task.status === 'waiting_approval') return '等待你审批。';
  if (task.status === 'waiting_external') return '等待外部系统或资料返回；可点继续尝试推进。';
  if (task.status === 'blocked') return '任务已卡住；可点继续执行让 Agent 重新规划。';
  if (task.status === 'planned') return '已规划，可点继续执行。';
  if (task.status === 'failed') return '执行失败，可点重试。';
  if (task.status === 'review') return '等待你确认结果或复盘。';
  if (task.status === 'done') return '任务已完成。';
  if (task.status === 'cancelled') return '任务已取消。';
  return '系统会继续推进。';
}

function riskLabel(risk: string) {
  if (risk === 'high') return '高';
  if (risk === 'medium') return '中';
  if (risk === 'low') return '低';
  return risk;
}

function attachmentKindLabel(kind: ReturnType<typeof classifyAttachment>) {
  const labels = {
    spreadsheet: '表格/线索/账务数据',
    knowledge_file: '知识库资料',
    image: '图片/截图',
    voice: '语音',
    file: '文件'
  };
  return labels[kind];
}

function attachmentNextStep(kind: ReturnType<typeof classifyAttachment>) {
  if (kind === 'spreadsheet') return '下一步：选择导入 CRM 或财务。';
  if (kind === 'image') return '下一步：可作为截图证据交给 Browser/QA Agent 分析。';
  if (kind === 'voice') return '下一步：可转成任务，让 Chief Agent 拆解执行。';
  return '下一步：可导入知识库，或作为某个任务的资料。';
}

function largestPhoto(photo?: TelegramPhotoSize[]) {
  return photo?.slice().sort((a, b) => (b.file_size ?? b.width * b.height) - (a.file_size ?? a.width * a.height))[0];
}

function truncate(value: string, max: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
