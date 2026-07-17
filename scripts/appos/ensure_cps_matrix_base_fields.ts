import { spawnSync } from 'node:child_process';
import {
  APPOS_FEISHU_BASE_TOKEN,
  type ApposFeishuTableName,
  resolveFeishuTableId
} from '../../src/appos/feishu/base-tables.js';

type FieldDefinition = {
  name: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'datetime' | 'attachment';
  multiple?: boolean;
  options?: Array<{ name: string }>;
  style?: Record<string, unknown>;
};

type ExistingField = {
  id: string;
  name: string;
  type: string;
};

const text = (name: string): FieldDefinition => ({ name, type: 'text' });
const checkbox = (name: string): FieldDefinition => ({ name, type: 'checkbox' });
const number = (name: string): FieldDefinition => ({ name, type: 'number' });
const attachment = (name: string): FieldDefinition => ({ name, type: 'attachment' });
const datetime = (name: string): FieldDefinition => ({
  name,
  type: 'datetime',
  style: { format: 'yyyy-MM-dd HH:mm' }
});
const select = (name: string, options: string[]): FieldDefinition => ({
  name,
  type: 'select',
  multiple: false,
  options: options.map((option) => ({ name: option }))
});

const sourcePlatform = () => select('素材平台', ['MoboBoost/CDReader', '北斗智影', '手动', '其他']);
const platform = () => select('平台', ['MoboBoost', '北斗智影', 'Facebook', 'TikTok', 'YouTube', 'Instagram', '其他']);
const loginStatus = () => select('登录状态', ['未登录', '已登录', '登录失效']);
const reportStatus = () => select('报白状态', ['未报白', '已报白', '不需要', '失败']);

const FIELD_SCHEMA = {
  CPSProducts: [
    text('剧名'),
    text('短剧ID'),
    sourcePlatform(),
    text('来源平台'),
    number('分佣比例'),
    number('付费起始集'),
    number('总集数'),
    text('短剧链接'),
    text('App链接'),
    text('口令'),
    text('推广文案'),
    text('封面链接'),
    attachment('封面'),
    select('状态', ['待下载', '待分析', '待剪辑', '待分发', '失败']),
    text('失败原因'),
    datetime('采集时间'),
    text('原始数据JSON')
  ],
  SourceMaterials: [
    text('剧名'),
    text('短剧ID'),
    sourcePlatform(),
    text('来源平台'),
    text('短剧链接'),
    text('App链接'),
    select('原片下载状态', ['未下载', '已完成', '失败']),
    text('本地素材目录'),
    text('已下载集数'),
    attachment('封面'),
    attachment('原片文件'),
    text('原片文件路径'),
    select('状态', ['待下载', '待分析', '待剪辑', '待分发', '失败']),
    text('失败原因'),
    datetime('采集时间')
  ],
  CloakProfiles: [
    text('Profile名称'),
    select('用途', ['素材采集', '分发', '两者']),
    text('Proxy'),
    number('cleanip分数'),
    select('Proxy状态', ['未检测', '合格', '不合格']),
    loginStatus(),
    datetime('最近检测时间'),
    text('备注')
  ],
  PlatformAccounts: [
    platform(),
    text('账号ID/频道ID'),
    text('账号昵称'),
    text('主页链接'),
    text('绑定Profile名称'),
    text('当前短剧名'),
    text('当前短剧链接'),
    text('当前App链接'),
    reportStatus(),
    loginStatus(),
    checkbox('是否启用'),
    text('备注')
  ],
  MediaAnalyses: [
    text('剧名'),
    text('短剧ID'),
    number('集数'),
    text('原片路径'),
    attachment('原片文件'),
    text('字幕文件路径'),
    attachment('字幕文件'),
    text('截图文件路径'),
    attachment('截图文件'),
    number('时长'),
    text('比例'),
    text('分辨率'),
    number('黑屏比例'),
    number('静音比例'),
    number('对白密度'),
    select('ASR状态', ['未开始', '完成', '失败']),
    text('分析报告路径'),
    attachment('分析报告'),
    text('媒体分析JSON')
  ],
  EditingVersions: [
    text('剧名'),
    text('短剧ID'),
    select('版本名', ['高燃冲突版', '悬念反转版', '解说引导版', '其他']),
    text('视频文件路径'),
    attachment('视频文件'),
    text('草稿链接'),
    text('剪辑策略JSON'),
    text('发布标题'),
    text('发布文案'),
    text('标签'),
    select('状态', ['待剪辑', '草稿已建', '已导出', '失败']),
    text('失败原因'),
    datetime('创建时间')
  ],
  PublishRecords: [
    text('剧名'),
    text('剪辑版本'),
    platform(),
    text('账号昵称'),
    text('绑定Profile名称'),
    number('cleanip分数'),
    text('短剧链接'),
    text('App链接'),
    text('发布文案'),
    datetime('发布时间'),
    select('发布状态', ['成功', '失败']),
    text('发布链接'),
    text('失败原因'),
    text('发布结果JSON')
  ],
  MediaJobs: [
    sourcePlatform(),
    text('product_id'),
    text('drama_id'),
    text('source_task_id'),
    number('episode_number'),
    text('job_stage'),
    text('input_video_path'),
    text('subtitle_path'),
    text('report_path'),
    text('screenshot_sample_paths'),
    text('中文说明')
  ]
} satisfies Partial<Record<ApposFeishuTableName, FieldDefinition[]>>;

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const larkCliScript = () => {
  if (process.platform !== 'win32') return 'lark-cli';
  return `${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`;
};

const runLarkCli = (args: string[]) => {
  const command = process.platform === 'win32' ? process.execPath : 'lark-cli';
  const finalArgs = process.platform === 'win32' ? [larkCliScript(), ...args] : args;
  const result = spawnSync(command, finalArgs, {
    encoding: 'utf8',
    shell: false,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${args.join(' ')}`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
    );
  }
  return result.stdout.trim();
};

const parseJsonOutput = (output: string) => {
  const start = output.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found in lark-cli output: ${output}`);
  return JSON.parse(output.slice(start)) as { data?: { fields?: ExistingField[] } };
};

const listFields = (baseToken: string, tableId: string) => {
  const output = runLarkCli([
    'base',
    '+field-list',
    '--base-token',
    baseToken,
    '--table-id',
    tableId,
    '--as',
    'user',
    '--format',
    'json'
  ]);
  return parseJsonOutput(output).data?.fields ?? [];
};

const createField = (baseToken: string, tableId: string, field: FieldDefinition, execute: boolean) => {
  if (!execute) {
    console.log(`dry-run create ${field.name}`);
    return;
  }
  runLarkCli([
    'base',
    '+field-create',
    '--base-token',
    baseToken,
    '--table-id',
    tableId,
    '--as',
    'user',
    '--json',
    JSON.stringify(field)
  ]);
  console.log(`created ${field.name}`);
};

const resolveTableIdForEnsure = (tableName: keyof typeof FIELD_SCHEMA, execute: boolean) => {
  try {
    return resolveFeishuTableId(tableName);
  } catch (error) {
    if (execute) throw error;
    console.log(`dry-run skip ${tableName}: ${(error as Error).message}`);
    return undefined;
  }
};

const ensureTableFields = (baseToken: string, tableName: keyof typeof FIELD_SCHEMA, execute: boolean) => {
  const tableId = resolveTableIdForEnsure(tableName, execute);
  if (!tableId) return;

  const fields = listFields(baseToken, tableId);
  const existingNames = new Set(fields.map((field) => field.name));
  for (const field of FIELD_SCHEMA[tableName] ?? []) {
    if (existingNames.has(field.name)) continue;
    createField(baseToken, tableId, field, execute);
  }
};

const main = () => {
  const baseToken = argValue('--base-token') ?? process.env.APPOS_FEISHU_BASE_APP_TOKEN ?? APPOS_FEISHU_BASE_TOKEN;
  const execute = process.argv.includes('--execute');
  for (const tableName of Object.keys(FIELD_SCHEMA) as Array<keyof typeof FIELD_SCHEMA>) {
    console.log(`\n[${tableName}]`);
    ensureTableFields(baseToken, tableName, execute);
  }
};

main();
