import type { InbeidouMediaEpisode } from './inbeidou-media.js';

export type InbeidouPromoLinkValue =
  | string
  | {
      serial?: string;
      app?: string;
      copy?: string;
    };

export type NormalizedPromoLink = {
  serial: string;
  app: string;
  copy: string;
};

export type InbeidouPromoLinks = Partial<Record<'tiktok' | 'facebook' | 'instagram' | 'youtube' | string, InbeidouPromoLinkValue>>;

export type InbeidouDownloadedFile =
  | [kind: string, localPath: string, sourceUrl?: string]
  | {
      kind?: string;
      type?: string;
      localPath?: string;
      path?: string;
      sourceUrl?: string;
      url?: string;
    };

export type InbeidouRawTask = {
  taskId?: string | number | null;
  appId?: string | null;
  enName?: string | null;
  chName?: string | null;
  platform?: string | null;
  platformSideId?: string | number | null;
  episodeCount?: string | number | null;
  language?: string | null;
  commissionRate?: string | number | null;
  onlineDate?: string | null;
  promoCopy?: string | null;
  coverImageUrl?: string | null;
  promoLinks?: InbeidouPromoLinks | null;
  downloadedFiles?: InbeidouDownloadedFile[] | null;
  listInfo?: Record<string, unknown> | null;
};

export type NormalizedInbeidouTask = {
  productId: string;
  taskId: string;
  appId: string;
  name: string;
  chName: string;
  platform: string;
  platformSideId: string;
  episodeCount: number | null;
  language: string;
  commissionRate: number | null;
  commissionRateRaw: string;
  onlineDate: string;
  promoCopy: string;
  coverImageUrl: string;
  promoLinks: Record<string, NormalizedPromoLink>;
  downloadedFiles: Array<{
    kind: string;
    localPath: string;
    sourceUrl: string;
  }>;
  mediaEpisodes?: InbeidouMediaEpisode[];
  source: 'inbeidou';
};

export type FeishuBatchPayload = {
  fields: string[];
  rows: unknown[][];
};

const PROMO_LINK_PRIORITY = ['facebook', 'tiktok', 'instagram', 'youtube'];

const SOURCE_MATERIAL_EXTRA_FIELDS = [
  'material_role',
  'episode_number',
  'duration_seconds',
  'orientation',
  'aspect_ratio',
  'dialogue_density',
  'black_ratio',
  'asr_status',
  'analysis_report_ref',
  'media_context_json'
] as const;

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

const stripLabel = (value: string) => value.replace(/^[^:：]+[:：]\s*/, '').trim();

const firstDownloadedPath = (task: NormalizedInbeidouTask, kind: string) =>
  task.downloadedFiles.find((file) => file.kind === kind)?.localPath ?? '';

export function parseCommissionRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1 ? value / 100 : value;
  }
  const text = asString(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return Number(match[1]) / 100;
}

export function parseEpisodeCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = asString(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function normalizePromoLinks(input: InbeidouPromoLinks | null | undefined) {
  const links: Record<string, NormalizedPromoLink> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const normalizedKey = idPart(key);
    if (!normalizedKey) continue;
    if (typeof value === 'string') {
      const url = asString(value);
      if (url) links[normalizedKey] = { serial: url, app: '', copy: '' };
      continue;
    }
    if (value && typeof value === 'object') {
      const serial = asString(value.serial);
      const app = asString(value.app);
      const copy = asString(value.copy);
      if (serial || app || copy) links[normalizedKey] = { serial, app, copy };
    }
  }
  return links;
}

function normalizeDownloadedFile(file: InbeidouDownloadedFile) {
  if (Array.isArray(file)) {
    return {
      kind: asString(file[0]) || 'material',
      localPath: asString(file[1]),
      sourceUrl: asString(file[2])
    };
  }
  return {
    kind: asString(file.kind ?? file.type) || 'material',
    localPath: asString(file.localPath ?? file.path),
    sourceUrl: asString(file.sourceUrl ?? file.url)
  };
}

export function normalizeInbeidouTask(task: InbeidouRawTask): NormalizedInbeidouTask {
  const taskId = asString(task.taskId) || 'unknown_task';
  const appId = asString(task.appId) || idPart(asString(task.platform)) || 'unknown_app';
  const name = asString(task.enName) || asString(task.chName) || `Inbeidou task ${taskId}`;
  const promoLinks = normalizePromoLinks(task.promoLinks);
  const downloadedFiles = (task.downloadedFiles ?? [])
    .map(normalizeDownloadedFile)
    .filter((file) => file.localPath || file.sourceUrl);

  return {
    productId: `cps_inbeidou_${idPart(appId)}_${idPart(taskId)}`,
    taskId,
    appId,
    name,
    chName: asString(task.chName),
    platform: asString(task.platform) || appId,
    platformSideId: asString(task.platformSideId),
    episodeCount: parseEpisodeCount(task.episodeCount),
    language: asString(task.language) || 'unknown',
    commissionRate: parseCommissionRate(task.commissionRate),
    commissionRateRaw: asString(task.commissionRate),
    onlineDate: asString(task.onlineDate),
    promoCopy: asString(task.promoCopy),
    coverImageUrl: asString(task.coverImageUrl),
    promoLinks,
    downloadedFiles,
    source: 'inbeidou'
  };
}

export function normalizeInbeidouResults(tasks: InbeidouRawTask[]) {
  return tasks.map(normalizeInbeidouTask);
}

function firstPromoLink(task: NormalizedInbeidouTask) {
  for (const key of PROMO_LINK_PRIORITY) {
    if (task.promoLinks[key]?.serial) return task.promoLinks[key].serial;
  }
  return Object.values(task.promoLinks)[0]?.serial ?? '';
}

function firstAppLink(task: NormalizedInbeidouTask) {
  for (const key of PROMO_LINK_PRIORITY) {
    if (task.promoLinks[key]?.app) return task.promoLinks[key].app;
  }
  return Object.values(task.promoLinks)[0]?.app ?? '';
}

const leafName = (value: string) => asString(value).split(/[\\/]/).pop()?.split('?')[0] ?? '';

const fileExt = (value: string) => {
  const leaf = leafName(value);
  const match = leaf.match(/\.([^.]+)$/);
  return match?.[1] ?? '';
};

function productRawData(task: NormalizedInbeidouTask) {
  return JSON.stringify({
    source: task.source,
    taskId: task.taskId,
    appId: task.appId,
    platform: task.platform,
    platformSideId: task.platformSideId,
    episodeCount: task.episodeCount,
    language: task.language,
    promoLinks: task.promoLinks,
    downloadedFiles: task.downloadedFiles,
    mediaEpisodeCount: task.mediaEpisodes?.length ?? 0
  });
}

function sourceTypeForMaterial(kind: string, hasLocalPath: boolean) {
  const normalized = idPart(kind);
  if (hasLocalPath) return 'local_storage';
  if (normalized.includes('cover') || normalized.includes('image')) return 'image_url';
  if (normalized.includes('video') || normalized.includes('episode')) return 'video_platform';
  return 'product_page';
}

function productRows(tasks: NormalizedInbeidouTask[], createdAt: string) {
  return tasks.map((task) => {
    const commissionText = stripLabel(task.commissionRateRaw);
    const onlineDate = stripLabel(task.onlineDate);
    const chName = stripLabel(task.chName);
    return [
      task.productId,
      task.name,
      firstPromoLink(task),
      task.commissionRate,
      null,
      task.promoCopy,
      'No auto-publish. Keep original dialogue clear. Do not publish without owner approval.',
      firstPromoLink(task) ? 'ready' : 'new',
      createdAt,
      chName || task.chName,
      task.name,
      task.platform,
      task.taskId,
      task.appId,
      task.platformSideId,
      task.episodeCount,
      task.language,
      task.commissionRateRaw,
      commissionText || task.commissionRateRaw,
      onlineDate || task.onlineDate,
      task.promoCopy,
      task.coverImageUrl,
      firstDownloadedPath(task, 'cover_image'),
      `Inbeidou CPS task: ${task.platform}, platform id ${task.platformSideId || 'unknown'}, episodes ${
        task.episodeCount ?? 'unknown'
      }, commission ${commissionText || task.commissionRateRaw || 'unknown'}.`,
      task.source,
      '北斗智影',
      task.taskId,
      task.taskId,
      task.appId,
      task.platform,
      task.platformSideId,
      task.name,
      chName || task.chName,
      '北斗智影',
      task.taskId,
      task.taskId,
      '短剧CPS',
      '',
      '',
      task.platform,
      [task.language, task.platform].filter(Boolean).join('；'),
      null,
      firstPromoLink(task),
      firstAppLink(task),
      '',
      task.promoCopy,
      task.downloadedFiles.map((file) => file.kind).join('；'),
      productRawData(task)
    ];
  });
}

function mediaContext(task: NormalizedInbeidouTask, episode: InbeidouMediaEpisode) {
  const transcriptText = episode.report.asr.transcriptText ?? '';
  return {
    productId: task.productId,
    taskId: task.taskId,
    appId: task.appId,
    episodeNumber: episode.episodeNumber,
    videoPath: episode.video.localPath,
    transcriptPath: episode.transcriptPath,
    reportPath: episode.reportPath,
    screenshotCount: episode.report.screenshots.length,
    screenshotSamplePaths: episode.report.screenshots.slice(0, 3).map((screenshot) => screenshot.path),
    transcriptStatus: episode.report.asr.status,
    transcriptLanguage: episode.report.asr.language,
    transcriptPreview: transcriptText.slice(0, 1000),
    probe: {
      durationSeconds: episode.report.probe.durationSeconds,
      sizeBytes: episode.report.probe.sizeBytes,
      width: episode.report.probe.width,
      height: episode.report.probe.height,
      aspectRatio: episode.report.probe.aspectRatio,
      orientation: episode.report.probe.orientation,
      frameRate: episode.report.probe.frameRate,
      videoCodec: episode.report.probe.videoCodec,
      audioCodec: episode.report.probe.audioCodec
    },
    quality: {
      blackRatio: episode.report.quality.blackRatio,
      blackDurationSeconds: episode.report.quality.blackDurationSeconds,
      dialogueDensity: episode.report.quality.dialogueDensity,
      silenceDurationSeconds: episode.report.quality.silenceDurationSeconds
    }
  };
}

function sourceMaterialExtraValues(
  task: NormalizedInbeidouTask,
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
  const pathOrUrl = options.localPath || options.videoPath || options.subtitlePath || options.sourceUrl || options.coverUrl || '';
  return [
    task.source,
    '北斗智影',
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
    options.videoPath ?? '',
    options.coverUrl ?? '',
    (options.screenshotPaths ?? []).join('；'),
    options.reportPath ?? '',
    options.durationSeconds ?? null,
    options.orientation ?? '',
    options.aspectRatio ?? '',
    options.dialogueDensity ?? null,
    options.blackRatio ?? null,
    options.description
  ];
}

function sourceMaterialRows(tasks: NormalizedInbeidouTask[], createdAt: string) {
  const rows: unknown[][] = [];
  for (const task of tasks) {
    const coverPath = firstDownloadedPath(task, 'cover_image');
    if (task.coverImageUrl || coverPath) {
      rows.push([
        `mat_${task.productId}_cover`,
        task.productId,
        coverPath ? 'local_storage' : 'image_url',
        task.coverImageUrl || coverPath,
        'platform_allowed',
        `Cover image for ${task.name}`,
        'ready',
        coverPath,
        createdAt,
        `${task.name} cover`,
        'cover_image',
        'Authorized by Inbeidou CPS task page. Review before publishing.',
        coverPath,
        `Cover asset for ${task.name}.`,
        'cover',
        null,
        null,
        null,
        null,
        null,
        null,
        'not_required',
        '',
        JSON.stringify({ productId: task.productId, taskId: task.taskId, coverImageUrl: task.coverImageUrl, coverPath }),
        ...sourceMaterialExtraValues(task, {
          role: '封面',
          action: '封面采集',
          sourceUrl: task.coverImageUrl,
          localPath: coverPath,
          coverUrl: task.coverImageUrl,
          description: '短剧封面资源，用于飞书预览、Dify 识别和发布封面候选。'
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
        `Episode ${episode.episodeNumber} source video for ${task.name}`,
        'ready',
        episode.video.localPath,
        createdAt,
        `${task.name} episode ${episode.episodeNumber} video`,
        'episode_video',
        'Authorized by Inbeidou CPS task page. Review before publishing.',
        episode.video.localPath,
        'Video asset for analysis and CapCut draft generation.',
        'episode_video',
        episode.episodeNumber,
        episode.report.probe.durationSeconds,
        episode.report.probe.orientation,
        episode.report.probe.aspectRatio,
        episode.report.quality.dialogueDensity,
        episode.report.quality.blackRatio,
        episode.report.asr.status,
        episode.reportPath,
        JSON.stringify(mediaContext(task, episode)),
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
          description: '原始剧集视频，供 Dify 读取分析报告并给 capcut-mate 生成剪辑草稿。'
        })
      ]);

      rows.push([
        `mat_${task.productId}_episode_${episode.episodeNumber}_subtitle`,
        task.productId,
        'local_storage',
        `generated://subtitle/${task.taskId}/ep${episode.episodeNumber}`,
        'platform_allowed',
        `Episode ${episode.episodeNumber} subtitle for ${task.name}`,
        episode.report.asr.status === 'done' ? 'ready' : 'needs_review',
        episode.transcriptPath,
        createdAt,
        `${task.name} episode ${episode.episodeNumber} subtitle`,
        'subtitle_srt',
        'Generated by AppOS media preprocess from authorized source video.',
        episode.transcriptPath,
        'Subtitle resource for Dify edit planning and CapCut caption import.',
        'subtitle',
        episode.episodeNumber,
        episode.report.probe.durationSeconds,
        episode.report.probe.orientation,
        episode.report.probe.aspectRatio,
        episode.report.quality.dialogueDensity,
        episode.report.quality.blackRatio,
        episode.report.asr.status,
        episode.reportPath,
        JSON.stringify(mediaContext(task, episode)),
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
          description: '英文字幕资源，供 Dify 剪辑策划和 capcut-mate 字幕导入使用。'
        })
      ]);
    }

    if (!task.mediaEpisodes?.length) {
      for (const [index, file] of task.downloadedFiles.entries()) {
        rows.push([
          `mat_${task.productId}_${idPart(file.kind)}_${index + 1}`,
          task.productId,
          sourceTypeForMaterial(file.kind, Boolean(file.localPath)),
          file.sourceUrl || file.localPath,
          'platform_allowed',
          `Inbeidou ${file.kind} material for ${task.name}`,
          file.localPath || file.sourceUrl ? 'ready' : 'needs_review',
          file.localPath,
          createdAt,
          `${task.name} ${file.kind}`,
          file.kind,
          'Authorized by Inbeidou CPS task page. Review before publishing.',
          file.localPath,
          `Raw collected material. kind=${file.kind}`,
          file.kind,
          null,
          null,
          null,
          null,
          null,
          null,
          'not_started',
          '',
          JSON.stringify({ productId: task.productId, taskId: task.taskId, kind: file.kind, localPath: file.localPath }),
          ...sourceMaterialExtraValues(task, {
            role: file.kind || '原始素材',
            action: '素材采集',
            sourceUrl: file.sourceUrl,
            localPath: file.localPath,
            videoPath: idPart(file.kind).includes('video') ? file.localPath : '',
            coverUrl: idPart(file.kind).includes('cover') ? file.sourceUrl || file.localPath : '',
            description: `北斗采集素材，类型=${file.kind || 'material'}。`
          })
        ]);
      }
    }
  }
  return rows;
}

function mediaJobRows(tasks: NormalizedInbeidouTask[], createdAt: string) {
  const rows: unknown[][] = [];
  for (const task of tasks) {
    for (const episode of task.mediaEpisodes ?? []) {
      rows.push([
        `job_${task.productId}_episode_${episode.episodeNumber}`,
        `mat_${task.productId}_episode_${episode.episodeNumber}_video`,
        'transcribe',
        episode.report.asr.status === 'done' ? 'done' : episode.report.asr.status === 'failed' ? 'failed' : 'running',
        JSON.stringify({
          productId: task.productId,
          taskId: task.taskId,
          episodeNumber: episode.episodeNumber,
          inputVideoPath: episode.video.localPath,
          transcriptPath: episode.transcriptPath
        }),
        JSON.stringify(mediaContext(task, episode)),
        JSON.stringify({
          subtitleResourceId: `mat_${task.productId}_episode_${episode.episodeNumber}_subtitle`,
          videoResourceId: `mat_${task.productId}_episode_${episode.episodeNumber}_video`
        }),
        createdAt,
        createdAt,
        task.source,
        '北斗智影',
        task.productId,
        task.taskId,
        task.taskId,
        episode.episodeNumber,
        'media_preprocess',
        episode.video.localPath,
        episode.transcriptPath,
        episode.reportPath,
        episode.report.screenshots
          .slice(0, 5)
          .map((screenshot) => screenshot.path)
          .join('；'),
        `第${episode.episodeNumber}集媒体预处理：ffprobe、ASR、截图、黑屏/对白密度分析。`
      ]);
    }
  }
  return rows;
}

const publishPlatformName = (platform: string) =>
  ({
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram',
    youtube: 'YouTube'
  })[platform] ?? platform;

function publishRecordRows(tasks: NormalizedInbeidouTask[]) {
  const rows: unknown[][] = [];
  for (const task of tasks) {
    for (const [platform, link] of Object.entries(task.promoLinks)) {
      const readablePlatform = publishPlatformName(platform);
      rows.push([
        `pub_${task.productId}_${idPart(platform)}`,
        '',
        task.productId,
        'other',
        `inbeidou_${idPart(platform)}`,
        link.serial,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        JSON.stringify({
          source: 'inbeidou',
          promoPlatform: platform,
          taskId: task.taskId,
          appId: task.appId,
          platform: task.platform,
          appUrl: link.app,
          promoCopy: link.copy
        }),
        readablePlatform,
        link.serial,
        link.app,
        link.copy,
        task.taskId,
        task.appId,
        task.platform,
        `${readablePlatform} promotion record. Review before publishing.`,
        task.source,
        '北斗智影',
        task.taskId,
        task.taskId,
        task.appId,
        task.platform,
        readablePlatform,
        'draft',
        'draft',
        link.serial,
        link.app,
        '',
        link.copy,
        '',
        '',
        `inbeidou_${idPart(platform)}`,
        '北斗智影',
        task.taskId
      ]);
    }
  }
  return rows;
}

export function buildFeishuBatchPayloads(tasks: NormalizedInbeidouTask[], now = new Date()) {
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
        '中文剧名',
        '英文剧名',
        '平台名称',
        '北斗任务ID',
        '应用ID',
        '平台ID',
        '剧集数',
        '语言',
        '分佣比例说明',
        '分佣比例',
        '上线时间',
        '短剧简介',
        '封面链接',
        '封面本地路径',
        '人工说明',
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
        '素材名称',
        '素材类型说明',
        '授权说明',
        '本地文件路径',
        '素材说明',
        ...SOURCE_MATERIAL_EXTRA_FIELDS,
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
    MediaJobs: {
      fields: [
        'id',
        'resource_id',
        'operation',
        'status',
        'input_json',
        'output_json',
        'evidence_refs_json',
        'created_at',
        'updated_at',
        'source_platform',
        'source_site_name',
        'product_id',
        'drama_id',
        'source_task_id',
        'episode_number',
        'job_stage',
        'input_video_path',
        'subtitle_path',
        'report_path',
        'screenshot_sample_paths',
        '中文说明'
      ],
      rows: mediaJobRows(tasks, createdAt)
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
  } satisfies Record<string, FeishuBatchPayload>;
}

export function buildDifyPayload(tasks: NormalizedInbeidouTask[], options: { operator?: string; editBriefPath?: string } = {}) {
  return {
    source: 'inbeidou',
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
      platformSideId: task.platformSideId,
      episodeCount: task.episodeCount,
      language: task.language,
      commissionRate: task.commissionRate,
      commissionRateRaw: task.commissionRateRaw,
      onlineDate: task.onlineDate,
      promoCopy: task.promoCopy,
      coverImageUrl: task.coverImageUrl,
      promoLinks: task.promoLinks,
      downloadedFiles: task.downloadedFiles,
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
      requiredOutput: ['analysis_report', 'edit_plan', 'english_voiceover_script', 'publish_caption', 'qa_checklist'],
      constraints: [
        'Do not export before owner approval',
        'Use 9:16 vertical format',
        'Target 90-120 seconds',
        'Do not cover key original dialogue',
        'Do not auto-publish'
      ]
    }))
  };
}
