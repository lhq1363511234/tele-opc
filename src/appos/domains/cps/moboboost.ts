import type { MediaPreprocessReport } from '../../media/preprocess.js';

export type MoboboostRawTask = {
  index?: number;
  displayIndex?: number;
  dramaId?: string | number | null;
  taskId?: string | number | null;
  title?: string | null;
  enName?: string | null;
  chName?: string | null;
  platform?: string | null;
  language?: string | null;
  dramaType?: string | null;
  subType?: string | null;
  audioType?: string | null;
  channel?: string | null;
  category?: string | null;
  commissionRate?: string | number | null;
  episodeCount?: string | number | null;
  paidFromEpisode?: string | number | null;
  coverImageUrl?: string | null;
  shortDramaLink?: string | null;
  appLink?: string | null;
  cloudDriveLink?: string | null;
  description?: string | null;
  materialActions?: string[] | null;
  rawText?: string | null;
  downloadedFiles?: Array<{ kind?: string; localPath?: string; sourceUrl?: string }> | null;
  originalVideoStatus?: string | null;
  originalVideoFailureCode?: string | null;
  originalVideoFailureReason?: string | null;
};

export type MoboboostDownloadTask = {
  action: string;
  status: 'pending_browser_confirmation' | 'ready';
  url?: string;
};

export type MoboboostPromoLink = {
  serial: string;
  app: string;
  copy: string;
};

export type NormalizedMoboboostTask = {
  productId: string;
  taskId: string;
  appId: string;
  name: string;
  chName: string;
  platform: string;
  language: string;
  dramaType: string;
  subType: string;
  audioType: string;
  channel: string;
  category: string;
  commissionRate: number | null;
  commissionRateRaw: string;
  episodeCount: number | null;
  paidFromEpisode: number | null;
  coverImageUrl: string;
  promoCopy: string;
  promoLinks: Record<string, MoboboostPromoLink>;
  downloadTasks: MoboboostDownloadTask[];
  downloadedFiles: Array<{ kind: string; localPath: string; sourceUrl: string }>;
  originalVideoStatus: string;
  originalVideoFailureCode: string;
  originalVideoFailureReason: string;
  mediaEpisodes?: Array<{
    episodeNumber: number;
    video: {
      episodeNumber: number;
      kind: string;
      localPath: string;
      sourceUrl: string;
    };
    analysisDir: string;
    transcriptPath: string;
    reportPath: string;
    report: MediaPreprocessReport;
  }>;
  rawText: string;
  source: 'moboboost';
};

export type MoboboostFeishuBatchPayload = {
  fields: string[];
  rows: unknown[][];
};

const asString = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

const idPart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const formatFeishuDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
};

export function parseMoboboostCommissionRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  const text = asString(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) / 100 : null;
}

export function parseMoboboostEpisodeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const text = asString(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function normalizeDownloadedFiles(input: MoboboostRawTask['downloadedFiles']) {
  return (input ?? [])
    .map((file) => ({
      kind: asString(file.kind) || 'material',
      localPath: asString(file.localPath),
      sourceUrl: asString(file.sourceUrl)
    }))
    .filter((file) => file.localPath || file.sourceUrl);
}

function normalizeDownloadTasks(task: MoboboostRawTask): MoboboostDownloadTask[] {
  const actions = [...new Set((task.materialActions ?? []).map(asString).filter(Boolean))];
  const tasks: MoboboostDownloadTask[] = actions.map((action) => ({ action, status: 'pending_browser_confirmation' }));
  const cloudDriveLink = asString(task.cloudDriveLink);
  if (cloudDriveLink) {
    tasks.push({ action: 'cloud_drive_link', status: 'ready', url: cloudDriveLink });
  }
  return tasks;
}

export function normalizeMoboboostTask(task: MoboboostRawTask): NormalizedMoboboostTask {
  const taskId = asString(task.dramaId ?? task.taskId) || 'unknown_drama';
  const platform = asString(task.platform) || 'MoboBoost';
  const appId = idPart(platform) || 'moboboost';
  const name = asString(task.title ?? task.enName ?? task.chName) || `MoboBoost drama ${taskId}`;
  const shortDramaLink = asString(task.shortDramaLink);
  const appLink = asString(task.appLink);
  const promoCopy = asString(task.description);
  const promoKey = idPart(platform) || 'moboboost';
  const promoLinks: Record<string, MoboboostPromoLink> = {};
  if (shortDramaLink || appLink || promoCopy) {
    promoLinks[promoKey] = {
      serial: shortDramaLink,
      app: appLink,
      copy: promoCopy
    };
  }

  return {
    productId: `cps_moboboost_${appId}_${idPart(taskId) || 'unknown'}`,
    taskId,
    appId,
    name,
    chName: asString(task.chName),
    platform,
    language: asString(task.language),
    dramaType: asString(task.dramaType),
    subType: asString(task.subType),
    audioType: asString(task.audioType),
    channel: asString(task.channel),
    category: asString(task.category),
    commissionRate: parseMoboboostCommissionRate(task.commissionRate),
    commissionRateRaw: asString(task.commissionRate),
    episodeCount: parseMoboboostEpisodeNumber(task.episodeCount),
    paidFromEpisode: parseMoboboostEpisodeNumber(task.paidFromEpisode),
    coverImageUrl: asString(task.coverImageUrl),
    promoCopy,
    promoLinks,
    downloadTasks: normalizeDownloadTasks(task),
    downloadedFiles: normalizeDownloadedFiles(task.downloadedFiles),
    originalVideoStatus: asString(task.originalVideoStatus),
    originalVideoFailureCode: asString(task.originalVideoFailureCode),
    originalVideoFailureReason: asString(task.originalVideoFailureReason),
    rawText: asString(task.rawText),
    source: 'moboboost'
  };
}

export function normalizeMoboboostResults(tasks: MoboboostRawTask[]) {
  return tasks.map(normalizeMoboboostTask);
}

function firstPromoLink(task: NormalizedMoboboostTask) {
  return Object.values(task.promoLinks)[0]?.serial ?? '';
}

function firstAppLink(task: NormalizedMoboboostTask) {
  return Object.values(task.promoLinks)[0]?.app ?? '';
}

const leafName = (value: string) => asString(value).split(/[\\/]/).pop()?.split('?')[0] ?? '';

const fileExt = (value: string) => {
  const leaf = leafName(value);
  const match = leaf.match(/\.([^.]+)$/);
  return match?.[1] ?? '';
};

function productRawData(task: NormalizedMoboboostTask) {
  return JSON.stringify({
    source: task.source,
    taskId: task.taskId,
    appId: task.appId,
    platform: task.platform,
    language: task.language,
    dramaType: task.dramaType,
    subType: task.subType,
    audioType: task.audioType,
    channel: task.channel,
    category: task.category,
    promoLinks: task.promoLinks,
    downloadTasks: task.downloadTasks,
    downloadedFiles: task.downloadedFiles,
    originalVideoStatus: task.originalVideoStatus,
    originalVideoFailureCode: task.originalVideoFailureCode,
    originalVideoFailureReason: task.originalVideoFailureReason,
    rawText: task.rawText
  });
}

function productRows(tasks: NormalizedMoboboostTask[], createdAt: string) {
  return tasks.map((task) => [
    task.productId,
    task.name,
    firstPromoLink(task),
    task.commissionRate,
    null,
    [
      `MoboBoost/CDReader source. Platform=${task.platform}.`,
      task.language ? `Language=${task.language}.` : '',
      task.dramaType ? `Drama type=${task.dramaType}.` : '',
      task.episodeCount ? `Episodes=${task.episodeCount}.` : '',
      task.paidFromEpisode ? `Paid from episode ${task.paidFromEpisode}.` : '',
      task.promoCopy
    ]
      .filter(Boolean)
      .join(' '),
    'No auto-publish. Use only platform-authorized materials. Human approval required before distribution.',
    firstPromoLink(task) ? 'ready' : 'new',
    createdAt,
    task.source,
    'MoboBoost/CDReader',
    task.taskId,
    task.taskId,
    task.appId,
    task.platform,
    task.appId,
    task.name,
    task.chName,
    'MoboBoost/CDReader',
    task.taskId,
    task.taskId,
    task.dramaType,
    task.subType,
    task.audioType,
    task.channel,
    task.category,
    task.paidFromEpisode,
    firstPromoLink(task),
    firstAppLink(task),
    '',
    task.promoCopy,
    task.downloadTasks.map((downloadTask) => downloadTask.action).join('；'),
    productRawData(task)
  ]);
}

function sourceMaterialExtraValues(
  task: NormalizedMoboboostTask,
  options: {
    role: string;
    action: string;
    episodeNumber?: number | null;
    sourceUrl?: string;
    localPath?: string;
    cloudDriveUrl?: string;
    subtitlePath?: string;
    videoPath?: string;
    coverUrl?: string;
    screenshotPaths?: string[];
    reportPath?: string;
    durationSeconds?: number | null;
    orientation?: string | null;
    aspectRatio?: string | null;
    dialogueDensity?: number | null;
    blackRatio?: number | null;
    description: string;
  }
) {
  const pathOrUrl = options.localPath || options.sourceUrl || options.cloudDriveUrl || '';
  return [
    task.source,
    'MoboBoost/CDReader',
    task.taskId,
    task.taskId,
    options.role,
    options.action,
    options.episodeNumber ?? null,
    leafName(pathOrUrl),
    fileExt(pathOrUrl),
    options.sourceUrl ?? '',
    options.cloudDriveUrl ?? '',
    options.subtitlePath ?? '',
    options.videoPath ?? options.localPath ?? '',
    options.role === '封面' ? options.sourceUrl ?? '' : '',
    (options.screenshotPaths ?? []).join('\n'),
    options.reportPath ?? '',
    options.durationSeconds ?? null,
    options.orientation ?? '',
    options.aspectRatio ?? '',
    options.dialogueDensity ?? null,
    options.blackRatio ?? null,
    options.description
  ];
}

function mediaContext(task: NormalizedMoboboostTask, episode: NonNullable<NormalizedMoboboostTask['mediaEpisodes']>[number]) {
  return {
    source: 'moboboost',
    productId: task.productId,
    taskId: task.taskId,
    dramaId: task.taskId,
    platform: task.platform,
    episodeNumber: episode.episodeNumber,
    sourceVideo: episode.video.localPath,
    transcriptPath: episode.transcriptPath,
    reportPath: episode.reportPath,
    probe: episode.report.probe,
    quality: episode.report.quality,
    transcriptStatus: episode.report.asr.status,
    transcriptPreview: episode.report.asr.transcriptText.slice(0, 1000),
    screenshots: episode.report.screenshots.slice(0, 5)
  };
}

function sourceMaterialRows(tasks: NormalizedMoboboostTask[], createdAt: string) {
  const rows: unknown[][] = [];
  for (const task of tasks) {
    const promoEntry = firstPromoLink(task);
    if (task.coverImageUrl) {
      rows.push([
        `mat_${task.productId}_cover`,
        task.productId,
        'image_url',
        task.coverImageUrl,
        'platform_allowed',
        `MoboBoost cover image for ${task.name}`,
        'ready',
        task.coverImageUrl,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: '封面',
          action: '封面采集',
          sourceUrl: task.coverImageUrl,
          description: '短剧封面资源，用于飞书预览、Dify 识别和发布封面候选。'
        })
      ]);
    }
    if (promoEntry) {
      rows.push([
        `mat_${task.productId}_promo_entry`,
        task.productId,
        'product_page',
        promoEntry,
        'platform_allowed',
        `MoboBoost short-drama promotion entry for ${task.name}`,
        'ready',
        promoEntry,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: '推广入口',
          action: '短剧推广链接采集',
          sourceUrl: promoEntry,
          description: '短剧推广落地页，用于后续发布记录和点击追踪。'
        })
      ]);
    }
    for (const episode of task.mediaEpisodes ?? []) {
      const screenshotPaths = episode.report.screenshots.slice(0, 5).map((screenshot) => screenshot.path);
      rows.push([
        `mat_${task.productId}_episode_${episode.episodeNumber}_video`,
        task.productId,
        'local_storage',
        episode.video.sourceUrl || episode.video.localPath,
        'platform_allowed',
        `MoboBoost episode ${episode.episodeNumber} source video for ${task.name}`,
        'ready',
        episode.video.localPath,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: '原始视频',
          action: `第${episode.episodeNumber}集视频预处理`,
          episodeNumber: episode.episodeNumber,
          sourceUrl: episode.video.sourceUrl,
          localPath: episode.video.localPath,
          videoPath: episode.video.localPath,
          screenshotPaths,
          reportPath: episode.reportPath,
          durationSeconds: episode.report.probe.durationSeconds,
          orientation: episode.report.probe.orientation,
          aspectRatio: episode.report.probe.aspectRatio,
          dialogueDensity: episode.report.quality.dialogueDensity,
          blackRatio: episode.report.quality.blackRatio,
          description: `原始剧集视频，供 Dify 读取分析报告并给 capcut-mate 生成剪辑草稿。${JSON.stringify(mediaContext(task, episode))}`
        })
      ]);

      rows.push([
        `mat_${task.productId}_episode_${episode.episodeNumber}_subtitle`,
        task.productId,
        'local_storage',
        `generated://subtitle/moboboost/${task.taskId}/ep${episode.episodeNumber}`,
        'platform_allowed',
        `MoboBoost episode ${episode.episodeNumber} subtitle for ${task.name}`,
        episode.report.asr.status === 'done' ? 'ready' : 'needs_review',
        episode.transcriptPath,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: '英文字幕',
          action: `第${episode.episodeNumber}集 ASR 字幕资源`,
          episodeNumber: episode.episodeNumber,
          sourceUrl: episode.video.sourceUrl,
          localPath: episode.transcriptPath,
          subtitlePath: episode.transcriptPath,
          videoPath: episode.video.localPath,
          screenshotPaths,
          reportPath: episode.reportPath,
          durationSeconds: episode.report.probe.durationSeconds,
          orientation: episode.report.probe.orientation,
          aspectRatio: episode.report.probe.aspectRatio,
          dialogueDensity: episode.report.quality.dialogueDensity,
          blackRatio: episode.report.quality.blackRatio,
          description: `英文字幕资源，供 Dify 剪辑策划和 capcut-mate 字幕导入使用。${JSON.stringify(mediaContext(task, episode))}`
        })
      ]);
    }
    for (const [index, file] of task.downloadedFiles.entries()) {
      if (!file.kind.toLowerCase().includes('subtitle_video')) continue;
      const numberMatches = [...`${file.kind} ${leafName(file.localPath)}`.matchAll(/(\d{1,3})/g)];
      const episodeNumber = numberMatches.length ? Number(numberMatches[numberMatches.length - 1]?.[1]) : null;
      rows.push([
        `mat_${task.productId}_${idPart(file.kind)}_${index + 1}`,
        task.productId,
        'local_storage',
        file.sourceUrl || file.localPath,
        'platform_allowed',
        `MoboBoost subtitle-burned video: ${file.kind}`,
        'ready',
        file.localPath || file.sourceUrl,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: '字幕视频',
          action: '网站字幕视频下载',
          episodeNumber,
          sourceUrl: file.sourceUrl,
          localPath: file.localPath,
          videoPath: file.localPath,
          description: `网站生成的带字幕视频素材，供飞书预览和人工核对字幕内容。类型=${file.kind}。`
        })
      ]);
    }
    for (const [index, downloadTask] of task.downloadTasks.entries()) {
      rows.push([
        `mat_${task.productId}_download_${index + 1}`,
        task.productId,
        downloadTask.url ? 'cloud_drive' : 'product_page',
        downloadTask.url ?? firstPromoLink(task),
        'platform_allowed',
        `MoboBoost material action: ${downloadTask.action}`,
        downloadTask.status === 'ready' ? 'ready' : 'needs_review',
        downloadTask.url ?? '',
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: downloadTask.url ? '网盘素材' : '下载任务',
          action: downloadTask.action,
          sourceUrl: downloadTask.url ? undefined : firstPromoLink(task),
          cloudDriveUrl: downloadTask.url,
          description: '浏览器素材动作记录，供 n8n/人工确认后继续下载或导入素材。'
        })
      ]);
    }
    if (!task.mediaEpisodes?.length) for (const [index, file] of task.downloadedFiles.entries()) {
      rows.push([
        `mat_${task.productId}_${idPart(file.kind)}_${index + 1}`,
        task.productId,
        file.localPath ? 'local_storage' : 'product_page',
        file.sourceUrl || file.localPath,
        'platform_allowed',
        `MoboBoost collected material: ${file.kind}`,
        'ready',
        file.localPath || file.sourceUrl,
        createdAt,
        ...sourceMaterialExtraValues(task, {
          role: file.kind || '已下载素材',
          action: '本地素材入库',
          sourceUrl: file.sourceUrl,
          localPath: file.localPath,
          description: `已下载素材，类型=${file.kind || 'material'}。`
        })
      ]);
    }
  }
  return rows;
}

function publishRecordRows(tasks: NormalizedMoboboostTask[]) {
  const rows: unknown[][] = [];
  for (const task of tasks) {
    for (const [platform, link] of Object.entries(task.promoLinks)) {
      rows.push([
        `pub_${task.productId}_${idPart(platform)}`,
        '',
        task.productId,
        'other',
        `moboboost_${idPart(platform)}`,
        link.serial,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify({
          source: 'moboboost',
          sourcePlatform: 'MoboBoost/CDReader',
          promoPlatform: platform,
          taskId: task.taskId,
          appId: task.appId,
          platform: task.platform,
          appUrl: link.app,
          promoCopy: link.copy
        }),
        platform,
        link.serial,
        link.app,
        link.copy,
        task.taskId,
        task.appId,
        task.platform,
        `${platform} promotion record from MoboBoost/CDReader. Review before publishing.`,
        task.source,
        'MoboBoost/CDReader',
        task.taskId,
        task.taskId,
        task.appId,
        task.platform,
        platform,
        'draft',
        'draft',
        link.serial,
        link.app,
        '',
        link.copy,
        '',
        '',
        `moboboost_${idPart(platform)}`,
        'MoboBoost/CDReader',
        task.taskId
      ]);
    }
  }
  return rows;
}

export function buildMoboboostFeishuBatchPayloads(tasks: NormalizedMoboboostTask[], now = new Date()) {
  const createdAt = formatFeishuDateTime(now);
  return {
    CPSProducts: {
      fields: [
        'id',
        'name',
        'cps_url',
        'commission_rate',
        'price',
        'core_selling_points',
        'forbidden_claims',
        'status',
        'created_at',
        'source_platform',
        'source_site_name',
        'drama_id',
        'source_task_id',
        'app_id',
        'app_name',
        'platform_side_id',
        'title_en',
        'title_cn',
        '来源平台',
        '来源剧ID',
        '来源任务ID',
        '短剧类型',
        '短剧子类型',
        '音轨类型',
        '频道',
        '分类标签',
        '开始收费集数',
        '短剧推广链接',
        'App推广链接',
        '推广口令',
        '推广文案',
        '素材动作',
        '数据原文'
      ],
      rows: productRows(tasks, createdAt)
    },
    SourceMaterials: {
      fields: [
        'id',
        'product_id',
        'source_type',
        'source_url',
        'license_status',
        'usage_notes',
        'status',
        'storage_ref',
        'created_at',
        'source_platform',
        'source_site_name',
        'drama_id',
        'source_task_id',
        '素材角色',
        '素材动作',
        '剧集序号',
        '文件名',
        '文件类型',
        '远程链接',
        '网盘链接',
        '字幕文件路径',
        '视频文件路径',
        '封面链接',
        '截图样例路径',
        '分析报告路径',
        '视频时长秒',
        '画面方向',
        '画幅比例',
        '对白密度',
        '黑屏比例',
        '工作流资源说明'
      ],
      rows: sourceMaterialRows(tasks, createdAt)
    },
    PublishRecords: {
      fields: [
        'id',
        'content_post_id',
        'product_id',
        'platform',
        'account_id',
        'publish_url',
        'published_at',
        'views',
        'likes',
        'comments',
        'clicks',
        'orders',
        'commission_amount',
        'metrics_json',
        '推广平台',
        '短剧推广链接',
        'APP推广链接',
        '推广文案',
        '北斗任务ID',
        '应用ID',
        '平台名称',
        '中文说明',
        'source_platform',
        'source_site_name',
        'drama_id',
        'source_task_id',
        'app_id',
        'app_name',
        'promo_platform',
        'publish_status',
        '发布状态',
        'short_drama_link',
        'app_link',
        'promo_code',
        'promo_copy',
        'video_asset_id',
        'draft_id',
        'account_profile',
        '来源平台',
        '来源任务ID'
      ],
      rows: publishRecordRows(tasks)
    }
  } satisfies Record<string, MoboboostFeishuBatchPayload>;
}

export function buildMoboboostDifyPayload(
  tasks: NormalizedMoboboostTask[],
  options: { operator?: string; editBriefPath?: string } = {}
) {
  return {
    source: 'moboboost' as const,
    sourcePlatform: 'MoboBoost/CDReader',
    operator: options.operator ?? 'tele-opc',
    editBriefPath: options.editBriefPath ?? '',
    workflow: 'short_drama_cps_edit_plan',
    tasks: tasks.map((task) => ({
      productId: task.productId,
      taskId: task.taskId,
      appId: task.appId,
      name: task.name,
      chName: task.chName,
      platform: task.platform,
      sourcePlatform: 'MoboBoost/CDReader',
      language: task.language,
      dramaType: task.dramaType,
      subType: task.subType,
      audioType: task.audioType,
      channel: task.channel,
      category: task.category,
      episodeCount: task.episodeCount,
      paidFromEpisode: task.paidFromEpisode,
      commissionRate: task.commissionRate,
      commissionRateRaw: task.commissionRateRaw,
      coverImageUrl: task.coverImageUrl,
      promoCopy: task.promoCopy,
      promoLinks: task.promoLinks,
      downloadTasks: task.downloadTasks,
      downloadedFiles: task.downloadedFiles,
      originalVideoStatus: task.originalVideoStatus,
      originalVideoFailureCode: task.originalVideoFailureCode,
      originalVideoFailureReason: task.originalVideoFailureReason,
      mediaEpisodes: (task.mediaEpisodes ?? []).map((episode) => ({
        episodeNumber: episode.episodeNumber,
        sourceMaterialId: `mat_${task.productId}_episode_${episode.episodeNumber}_video`,
        subtitleMaterialId: `mat_${task.productId}_episode_${episode.episodeNumber}_subtitle`,
        mediaJobId: `job_${task.productId}_episode_${episode.episodeNumber}`,
        sourceVideo: episode.video.localPath,
        transcriptPath: episode.transcriptPath,
        reportPath: episode.reportPath,
        transcriptText: episode.report.asr.transcriptText,
        transcriptStatus: episode.report.asr.status,
        screenshots: episode.report.screenshots,
        keyframes: episode.report.keyframes,
        quality: episode.report.quality,
        probe: episode.report.probe
      })),
      rawText: task.rawText,
      requiredOutput: ['analysis_report', 'edit_plan', 'english_voiceover_script', 'publish_caption', 'qa_checklist'],
      constraints: [
        'Do not export before owner approval',
        'Use 9:16 vertical format',
        'Prefer 90-180 second coherent drama segments',
        'Use English subtitles only',
        'Apply secondary-editing copyright-safe transformations',
        'Do not auto-publish'
      ]
    }))
  };
}
