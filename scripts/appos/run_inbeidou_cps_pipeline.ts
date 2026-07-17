import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildDifyPayload,
  buildFeishuBatchPayloads,
  normalizeInbeidouResults,
  type FeishuBatchPayload,
  type InbeidouRawTask,
  type NormalizedInbeidouTask
} from '../../src/appos/domains/cps/inbeidou.js';
import { enrichTaskWithMedia } from '../../src/appos/domains/cps/inbeidou-media.js';
import { ensureCloakBrowserProfileReady } from '../../src/appos/domains/cps/cloakbrowser-prerequisites.js';
import { resolveFeishuTableId } from '../../src/appos/feishu/base-tables.js';

type CliOptions = {
  scrape: boolean;
  discoverOnly: boolean;
  all: boolean;
  tasks: string[];
  noDownload: boolean;
  noLinks: boolean;
  writeFeishu: boolean;
  triggerDify: boolean;
  preprocessMedia: boolean;
  inputEnriched: boolean;
  inputPath: string;
  outputDir: string;
  mediaOutputDir: string;
  scraperScript: string;
  difyWebhookUrl: string;
  editBriefPath: string;
  whisperModelPath: string;
  whisperCliPath: string;
  whisperCliModel: string;
  mediaSampleCount: number;
  mediaLanguage: string;
  skipCloakBrowserPrerequisites: boolean;
};

const defaultSkillScraper = path.resolve(
  process.cwd(),
  'runtime',
  'inbeidou-cps-skill',
  'inbeidou-cps',
  'scripts',
  'cps_scrape.py'
);

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const argList = (flag: string) => {
  const value = argValue(flag);
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const readOptions = (): CliOptions => {
  const outputDir = path.resolve(argValue('--output-dir') ?? process.env.CPS_OUTPUT_DIR ?? 'runtime/inbeidou-cps-output');
  return {
    scrape: process.argv.includes('--scrape'),
    discoverOnly: process.argv.includes('--discover-only'),
    all: process.argv.includes('--all'),
    tasks: argList('--tasks'),
    noDownload: process.argv.includes('--no-download'),
    noLinks: process.argv.includes('--no-links'),
    writeFeishu: process.argv.includes('--write-feishu'),
    triggerDify: process.argv.includes('--trigger-dify'),
    inputEnriched: process.argv.includes('--input-enriched'),
    preprocessMedia:
      !process.argv.includes('--input-enriched') &&
      (process.argv.includes('--preprocess-media') || process.argv.includes('--write-feishu') || process.argv.includes('--trigger-dify')),
    inputPath: path.resolve(argValue('--input') ?? path.join(outputDir, 'cps_results.json')),
    outputDir,
    mediaOutputDir: path.resolve(argValue('--media-output-dir') ?? path.join(outputDir, 'media-preprocess')),
    scraperScript: path.resolve(argValue('--scraper-script') ?? process.env.INBEIDOU_CPS_SCRAPER_SCRIPT ?? defaultSkillScraper),
    difyWebhookUrl: argValue('--dify-webhook-url') ?? process.env.APPOS_DIFY_INBEIDOU_WEBHOOK_URL ?? '',
    editBriefPath: argValue('--edit-brief') ?? process.env.CPS_EDIT_BRIEF_PATH ?? 'D:/360MoveData/Users/Cir/Desktop/剪辑思路.txt',
    whisperModelPath: argValue('--whisper-model') ?? process.env.APPOS_WHISPER_MODEL_PATH ?? '',
    whisperCliPath: argValue('--whisper-cli') ?? process.env.APPOS_WHISPER_CLI_PATH ?? '',
    whisperCliModel: argValue('--whisper-cli-model') ?? process.env.APPOS_WHISPER_CLI_MODEL ?? '',
    mediaSampleCount: Number(argValue('--media-samples') ?? '8'),
    mediaLanguage: argValue('--media-language') ?? process.env.APPOS_ASR_LANGUAGE ?? 'en',
    skipCloakBrowserPrerequisites: process.argv.includes('--skip-cloakbrowser-prerequisites')
  };
};

const run = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) => {
  const printable = [command, ...args].map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: options.env ?? process.env,
    cwd: options.cwd
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${printable}`);
  }
};

const runJson = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) => {
  const printable = [command, ...args].map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${printable}\n${result.stderr || result.stdout}`);
  }
  const stdout = result.stdout.trim();
  if (!stdout) return {};
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(
      `Command did not return valid JSON: ${printable}\nstdout:\n${stdout.slice(0, 4000)}\nstderr:\n${result.stderr.slice(0, 4000)}`
    );
  }
};

const runScraper = (options: CliOptions) => {
  if (!existsSync(options.scraperScript)) {
    throw new Error(`Inbeidou scraper script not found: ${options.scraperScript}`);
  }
  mkdirSync(options.outputDir, { recursive: true });

  const args = [options.scraperScript, '--output', options.outputDir];
  if (options.discoverOnly) {
    args.push('--list-only');
  } else if (options.all) {
    args.push('--all');
  } else if (options.tasks.length > 0) {
    args.push('--tasks', ...options.tasks);
  }
  if (options.noDownload) args.push('--no-download');
  if (options.noLinks) args.push('--no-links');

  run('python', args, {
    env: {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
      CPS_OUTPUT_DIR: options.outputDir
    }
  });
};

const readScrapeResults = (inputPath: string) => {
  if (!existsSync(inputPath)) {
    throw new Error(`Scrape result file not found: ${inputPath}`);
  }
  const data = JSON.parse(readFileSync(inputPath, 'utf8')) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`Scrape result must be a JSON array: ${inputPath}`);
  }
  return data as InbeidouRawTask[];
};

const writeJson = (filePath: string, data: unknown) => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${filePath}`);
};

const writeSelectionPayloads = (outputDir: string) => {
  const candidatesPath = path.join(outputDir, 'task_candidates.json');
  if (!existsSync(candidatesPath)) return;
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8')) as Array<Record<string, unknown>>;
  const byPlatform = new Map<string, Array<Record<string, unknown>>>();
  for (const candidate of candidates) {
    const platform = String(candidate.platform || '未知平台').trim() || '未知平台';
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), candidate]);
  }
  const platformOptions = [...byPlatform.entries()].map(([platform, rows]) => ({
    value: platform,
    label: `${platform}（${rows.length} 部）`,
    description: rows
      .slice(0, 3)
      .map((row) => String(row.enName || row.chName || ''))
      .filter(Boolean)
      .join(' / ')
  }));
  const taskOptionsByPlatform = Object.fromEntries(
    [...byPlatform.entries()].map(([platform, rows]) => [
      platform,
      rows.map((candidate) => ({
        value: String(candidate.index ?? ''),
        label: `#${candidate.displayIndex ?? ''} ${candidate.enName ?? candidate.chName ?? ''}`,
        description: [candidate.commissionRate, candidate.infoDesc].filter(Boolean).join(' | '),
        command: `npm run appos:inbeidou:cps -- --scrape --tasks ${candidate.index} --output-dir ${outputDir} --preprocess-media --media-language en`
      }))
    ])
  );
  writeJson(path.join(outputDir, 'platform_selection_payload.json'), {
    type: 'inbeidou_cps_platform_selection',
    title: '选择北斗智影平台',
    instruction: '老板先选择平台，再选择该平台下要拉取的短剧。',
    options: platformOptions
  });
  writeJson(path.join(outputDir, 'task_selection_by_platform.json'), {
    type: 'inbeidou_cps_task_selection_by_platform',
    title: '按平台选择要拉取的短剧',
    instruction: '选择平台后展示对应短剧；选择短剧后执行 command 下载素材、媒体预处理和 AI 剪辑规划。',
    platforms: taskOptionsByPlatform
  });
};

const larkCliCommand = () => {
  if (process.platform !== 'win32') return { command: 'lark-cli', prefixArgs: [] as string[] };
  const cliPath = `${process.env.APPDATA}\\npm\\node_modules\\@larksuite\\cli\\scripts\\run.js`;
  return { command: 'node', prefixArgs: [cliPath] };
};

const sourceMaterialStructuredFields = [
  { name: 'material_role', type: 'select', multiple: false, options: ['cover', 'episode_video', 'subtitle', 'raw_material'].map((name) => ({ name })) },
  { name: 'episode_number', type: 'number' },
  { name: 'duration_seconds', type: 'number' },
  { name: 'orientation', type: 'select', multiple: false, options: ['vertical', 'horizontal', 'square', 'unknown'].map((name) => ({ name })) },
  { name: 'aspect_ratio', type: 'text' },
  { name: 'dialogue_density', type: 'number' },
  { name: 'black_ratio', type: 'number' },
  { name: 'asr_status', type: 'select', multiple: false, options: ['done', 'skipped', 'failed', 'not_required', 'not_started'].map((name) => ({ name })) },
  { name: 'analysis_report_ref', type: 'text' },
  { name: 'media_context_json', type: 'text' }
] as const;

const ensureSourceMaterialFields = (options: CliOptions) => {
  if (!options.writeFeishu) return;
  const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  if (!baseToken) return;
  const tableId = resolveFeishuTableId('SourceMaterials');
  const { command, prefixArgs } = larkCliCommand();
  const fieldList = runJson(command, [
    ...prefixArgs,
    'base',
    '+field-list',
    '--base-token',
    baseToken,
    '--table-id',
    tableId
  ]) as { data?: { fields?: Array<{ name?: string }> } };
  const existing = new Set((fieldList.data?.fields ?? []).map((field) => field.name).filter(Boolean));
  for (const field of sourceMaterialStructuredFields) {
    if (existing.has(field.name)) continue;
    run(command, [
      ...prefixArgs,
      'base',
      '+field-create',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      '--json',
      JSON.stringify(field)
    ]);
  }
};

const rowToRecord = (payload: FeishuBatchPayload, row: unknown[]) =>
  Object.fromEntries(payload.fields.map((field, index) => [field, row[index] ?? null]));

const findExistingRecordId = (tableId: string, businessId: string) => {
  const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  if (!baseToken || !businessId) return '';
  const { command, prefixArgs } = larkCliCommand();
  const result = runJson(command, [
    ...prefixArgs,
    'base',
    '+record-list',
    '--base-token',
    baseToken,
    '--table-id',
    tableId,
    '--field-id',
    'id',
    '--filter-json',
    JSON.stringify({ logic: 'and', conditions: [['id', '==', businessId]] }),
    '--limit',
    '10',
    '--format',
    'json'
  ]) as { data?: { record_id_list?: string[] } };
  const recordIds = result.data?.record_id_list ?? [];
  if (recordIds.length > 1) {
    console.warn(`Found ${recordIds.length} existing rows for id=${businessId}; updating ${recordIds[0]}.`);
  }
  return recordIds[0] ?? '';
};

const upsertFeishuRows = (tableName: string, payload: FeishuBatchPayload) => {
  const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  if (!baseToken) {
    throw new Error('APPOS_FEISHU_BASE_APP_TOKEN is required when --write-feishu is set');
  }
  const idIndex = payload.fields.indexOf('id');
  if (idIndex === -1) {
    throw new Error(`Feishu payload for ${tableName} must include an id field for idempotent writes`);
  }
  const tableId = resolveFeishuTableId(tableName);
  const { command, prefixArgs } = larkCliCommand();
  const recordIds: string[] = [];
  for (const row of payload.rows) {
    const businessId = String(row[idIndex] ?? '');
    const existingRecordId = findExistingRecordId(tableId, businessId);
    const result = runJson(command, [
      ...prefixArgs,
      'base',
      '+record-upsert',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      ...(existingRecordId ? ['--record-id', existingRecordId] : []),
      '--json',
      JSON.stringify(rowToRecord(payload, row))
    ]) as { data?: { record_id?: string; id?: string; record?: { record_id?: string; id?: string } } };
    const recordId =
      result.data?.record?.record_id ??
      result.data?.record?.id ??
      result.data?.record_id ??
      result.data?.id ??
      existingRecordId ??
      findExistingRecordId(tableId, businessId);
    recordIds.push(recordId);
  }
  return recordIds;
};

const uploadSourceMaterialAttachments = (payload: FeishuBatchPayload, recordIds: string[]) => {
  const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  if (!baseToken) return;
  const tableId = resolveFeishuTableId('SourceMaterials');
  const storageIndex = payload.fields.indexOf('storage_ref');
  if (storageIndex === -1) return;
  const { command, prefixArgs } = larkCliCommand();
  for (const [index, row] of payload.rows.entries()) {
    const recordId = recordIds[index];
    const filePath = String(row[storageIndex] ?? '');
    if (!recordId || !filePath || !existsSync(filePath)) continue;
    const uploadFile = attachmentUploadFileArg(filePath);
    run(command, [
      ...prefixArgs,
      'base',
      '+record-upload-attachment',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      '--record-id',
      recordId,
      '--field-id',
      'fld0v0BsuD',
      '--file',
      uploadFile.fileArg
    ], { cwd: uploadFile.cwd });
  }
};

const attachmentUploadFileArg = (filePath: string) => {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), absolutePath);
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return { cwd: process.cwd(), fileArg: `.${path.sep}${relativePath}` };
  }
  return { cwd: path.dirname(absolutePath), fileArg: `.${path.sep}${path.basename(absolutePath)}` };
};

const uploadCpsProductCoverAttachments = (payload: FeishuBatchPayload, recordIds: string[]) => {
  const baseToken = process.env.APPOS_FEISHU_BASE_APP_TOKEN;
  if (!baseToken) return;
  const tableId = resolveFeishuTableId('CPSProducts');
  const coverIndex = payload.fields.indexOf('封面本地路径');
  if (coverIndex === -1) return;
  const { command, prefixArgs } = larkCliCommand();
  for (const [index, row] of payload.rows.entries()) {
    const recordId = recordIds[index];
    const filePath = String(row[coverIndex] ?? '');
    if (!recordId || !filePath || !existsSync(filePath)) continue;
    const uploadFile = attachmentUploadFileArg(filePath);
    run(command, [
      ...prefixArgs,
      'base',
      '+record-upload-attachment',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      '--record-id',
      recordId,
      '--field-id',
      'fldJBcGT0T',
      '--file',
      uploadFile.fileArg
    ], { cwd: uploadFile.cwd });
  }
};

const writeFeishuPayload = (tableName: string, payload: FeishuBatchPayload) => {
  if (payload.rows.length === 0) {
    console.log(`Skip ${tableName}: no rows`);
    return;
  }

  const recordIds = upsertFeishuRows(tableName, payload);
  if (tableName === 'SourceMaterials') {
    uploadSourceMaterialAttachments(payload, recordIds);
  } else if (tableName === 'CPSProducts') {
    uploadCpsProductCoverAttachments(payload, recordIds);
  }
  console.log(`Upserted ${payload.rows.length} rows in ${tableName}`);
};

const triggerDify = async (payload: unknown, options: CliOptions) => {
  if (!options.difyWebhookUrl) {
    throw new Error('APPOS_DIFY_INBEIDOU_WEBHOOK_URL or --dify-webhook-url is required when --trigger-dify is set');
  }
  const response = await fetch(options.difyWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Dify webhook failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  console.log(`Dify webhook accepted: ${text.slice(0, 500)}`);
};

export async function main() {
  const options = readOptions();
  mkdirSync(options.outputDir, { recursive: true });

  if (options.scrape) {
    if (!options.skipCloakBrowserPrerequisites) {
      const prerequisite = await ensureCloakBrowserProfileReady();
      console.log(
        `CloakBrowser ready: manager=${prerequisite.baseUrl}, profile=${prerequisite.profileId}, cdp=${prerequisite.cdpReady}`
      );
    }
    runScraper(options);
  }

  if (options.discoverOnly) {
    writeSelectionPayloads(options.outputDir);
    console.log(`Discovery complete. Choose a task index from ${path.join(options.outputDir, 'task_candidates.json')}.`);
    return;
  }

  const rawTasks = readScrapeResults(options.inputPath);
  const normalizedTasks = options.inputEnriched ? (rawTasks as unknown as NormalizedInbeidouTask[]) : normalizeInbeidouResults(rawTasks);
  const tasks = options.preprocessMedia
    ? normalizedTasks.map((task) =>
        enrichTaskWithMedia(task, {
          outputDir: options.mediaOutputDir,
          whisperModelPath: options.whisperModelPath || undefined,
          whisperCliPath: options.whisperCliPath || undefined,
          whisperCliModel: options.whisperCliModel || undefined,
          sampleCount: Number.isFinite(options.mediaSampleCount) ? options.mediaSampleCount : 8,
          language: options.mediaLanguage
        })
      )
    : normalizedTasks;
  const feishuPayloads = buildFeishuBatchPayloads(tasks);
  const difyPayload = buildDifyPayload(tasks, {
    operator: 'opctoai',
    editBriefPath: options.editBriefPath
  });

  writeJson(path.join(options.outputDir, 'normalized_tasks.json'), tasks);
  writeJson(path.join(options.outputDir, 'enriched_tasks.json'), tasks);
  writeJson(path.join(options.outputDir, 'dify_short_drama_cps_payload.json'), difyPayload);
  for (const [tableName, payload] of Object.entries(feishuPayloads)) {
    writeJson(path.join(options.outputDir, `feishu_${tableName}.json`), payload);
  }

  if (options.writeFeishu) {
    ensureSourceMaterialFields(options);
    for (const [tableName, payload] of Object.entries(feishuPayloads)) {
      writeFeishuPayload(tableName, payload);
    }
  } else {
    console.log('Feishu write skipped. Add --write-feishu to create rows.');
  }

  if (options.triggerDify) {
    await triggerDify(difyPayload, options);
  } else {
    console.log('Dify webhook skipped. Add --trigger-dify to call the configured webhook.');
  }

  console.log(`Processed ${tasks.length} Inbeidou CPS task(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

