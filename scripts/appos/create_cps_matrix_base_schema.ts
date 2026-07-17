import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPOS_FEISHU_TABLES, type ApposFeishuTableName } from '../../src/appos/feishu/base-tables.js';

type Field = Record<string, unknown>;

type TableSchema = {
  name: string;
  fields: Field[];
};

const text = (name: string): Field => ({ name, type: 'text' });
const checkbox = (name: string): Field => ({ name, type: 'checkbox' });
const number = (name: string): Field => ({ name, type: 'number' });
const attachment = (name: string): Field => ({ name, type: 'attachment' });
const datetime = (name: string): Field => ({
  name,
  type: 'datetime',
  style: { format: 'yyyy-MM-dd HH:mm' }
});
const select = (name: string, options: string[]): Field => ({
  name,
  type: 'select',
  multiple: false,
  options: options.map((option) => ({ name: option }))
});

const sourcePlatform = () => select('素材平台', ['MoboBoost/CDReader', '北斗智影', '手动', '其他']);
const platform = () => select('平台', ['MoboBoost', '北斗智影', 'Facebook', 'TikTok', 'YouTube', 'Instagram', '其他']);
const loginStatus = () => select('登录状态', ['未登录', '已登录', '登录失效']);
const reportStatus = () => select('报白状态', ['未报白', '已报白', '不需要', '失败']);
const displayNameFor = (name: string) => APPOS_FEISHU_TABLES[name as ApposFeishuTableName]?.displayName ?? name;

export const cpsTables: TableSchema[] = [
  {
    name: 'CPSProducts',
    fields: [
      text('id'),
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
    ]
  },
  {
    name: 'SourceMaterials',
    fields: [
      text('id'),
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
    ]
  },
  {
    name: 'CloakProfiles',
    fields: [
      text('Profile名称'),
      select('用途', ['素材采集', '分发', '两者']),
      text('Proxy'),
      number('cleanip分数'),
      select('Proxy状态', ['未检测', '合格', '不合格']),
      loginStatus(),
      datetime('最近检测时间'),
      text('备注')
    ]
  },
  {
    name: 'PlatformAccounts',
    fields: [
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
    ]
  },
  {
    name: 'MediaAnalyses',
    fields: [
      text('id'),
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
    ]
  },
  {
    name: 'EditingTemplates',
    fields: [
      text('id'),
      text('模板名'),
      select('格式', ['short_video_9_16', 'mixed']),
      number('目标时长秒'),
      text('钩子规则'),
      text('字幕样式JSON'),
      text('capcut参数JSON'),
      select('状态', ['启用', '草稿', '停用'])
    ]
  },
  {
    name: 'EditingVersions',
    fields: [
      text('id'),
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
    ]
  },
  {
    name: 'PublishRecords',
    fields: [
      text('id'),
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
    ]
  }
];

const run = (cmd: string, args: string[]) => {
  const executable = process.platform === 'win32' && cmd === 'lark-cli' ? 'node' : cmd;
  const finalArgs =
    process.platform === 'win32' && cmd === 'lark-cli'
      ? [`${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`, ...args]
      : args;
  const result = spawnSync(executable, finalArgs, {
    stdio: 'inherit',
    shell: false,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const writeFieldFiles = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  for (const table of cpsTables) {
    writeFileSync(path.join(dir, `${table.name}.fields.json`), JSON.stringify(table.fields, null, 2), 'utf8');
  }
};

const main = () => {
  const baseToken = argValue('--base-token') ?? process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  const fieldsDir = argValue('--fields-dir') ?? 'runtime/cps-feishu-fields';
  const execute = process.argv.includes('--execute');
  writeFieldFiles(fieldsDir);

  if (!baseToken) {
    throw new Error('Missing --base-token or APPOS_FEISHU_BASE_APP_TOKEN');
  }

  for (const table of cpsTables) {
    run('lark-cli', [
      'base',
      '+table-create',
      '--base-token',
      baseToken,
      '--name',
      displayNameFor(table.name),
      '--fields',
      `@${path.join(fieldsDir, `${table.name}.fields.json`)}`,
      ...(execute ? [] : ['--dry-run'])
    ]);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
