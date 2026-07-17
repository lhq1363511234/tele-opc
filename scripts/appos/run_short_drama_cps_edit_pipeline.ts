import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import {
  normalizeAiGeneratedTimelineForCapcut,
  parseSrtCues,
  remapSrtCuesToTimeline,
  stabilizeCaptionsForDraft,
  secondaryEditTransformForSegment,
  estimateVideoBitrateKbpsForCapcutLimit,
  toCapcutCaptions,
  type SecondaryEditTransform,
  type SubtitleCue
} from '../../src/appos/domains/cps/short-drama-capcut-prep.js';
import {
  type EditPlanVariant,
  type ShortDramaEditPlan,
  generateShortDramaEditPlan,
  normalizeShortDramaTask
} from '../../src/appos/domains/cps/short-drama-edit-planner.js';
import { validateExecutableEditPlan } from '../../src/appos/domains/cps/drama-run.js';

type PipelineArgs = {
  payloadPath: string;
  outputDir: string;
  guidePath?: string;
  planPath?: string;
  skipCapcut: boolean;
  maxVariants: number;
  variantIndexes?: number[];
};

type CapcutDraftResult = {
  variantId: string;
  variantName: string;
  draftUrl?: string;
  status: 'created' | 'failed' | 'skipped';
  clips: Array<{
    episode: number;
    sourceStart: number;
    sourceEnd: number;
    draftStart?: number;
    draftEnd?: number;
    duration?: number;
    secondaryEdit?: SecondaryEditTransform;
    clipPath?: string;
    error?: string;
  }>;
  capcutResponses: Record<string, unknown>[];
  error?: string;
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;

const writeJson = (filePath: string, data: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const loadRuntimeEnv = () => {
  const rootEnv = 'B:\\Cir\\CodexProjects\\opc-local.env';
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: false });
  dotenv.config({ override: false });
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }
};

const parseArgs = (): PipelineArgs => {
  const payloadPath = argValue('--payload');
  if (!payloadPath) throw new Error('Missing --payload <path>');
  const variantIndexesArg = argValue('--variant-indexes');
  return {
    payloadPath: path.resolve(payloadPath),
    outputDir: path.resolve(argValue('--output-dir') ?? `runtime/short-drama-cps-edit-${Date.now()}`),
    guidePath: argValue('--guide') ? path.resolve(argValue('--guide') as string) : undefined,
    planPath: argValue('--plan') ? path.resolve(argValue('--plan') as string) : undefined,
    skipCapcut: hasFlag('--skip-capcut'),
    maxVariants: Number(argValue('--max-variants') ?? '3'),
    variantIndexes: variantIndexesArg
      ? variantIndexesArg
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value >= 0)
      : undefined
  };
};

const defaultGuide = [
  '短剧 CPS 剪辑指南：',
  'AI 需要自主判断每一集的最强钩子、切点、混剪/预告/回顾型素材，并一直覆盖到最后一集。',
  '不能假设第 1 集一定是混剪；每一集都必须自行判断素材类型。',
  '正常剧情集的成片应从本集最强钩子开始；如果本集钩子前铺垫需要保留，且存在上一条成片，则放到上一条成片结尾，purpose 使用 next_episode_pre_hook_setup。',
  'AI 必须生成三套完整的全剧剪辑策略：高燃冲突版、悬念反转版、解说引导版。每一套都要从头剪到尾，覆盖到最后一集。',
  '三套策略都要分别生成自己的钩子、timeline、顶部字幕、旁白/引导、发布文案、风险说明和二创包装重点。',
  '每个可执行 cut 目标 90-180 秒，9:16，英文字幕，只保留英文。',
  '所有版本必须做二创增强：重构图、轻微缩放裁切、调色、去黑屏、顶部钩子字幕、重编码和版权风险提示。',
  '老板确认后才能发布。'
].join('\n');
const defaultGuidePath = path.resolve('docs/appos/INBEIDOU_SHORT_DRAMA_EDIT_GUIDE.zh-CN.md');

const readGuide = (guidePath?: string) => {
  if (guidePath && fs.existsSync(guidePath)) return fs.readFileSync(guidePath, 'utf8');
  if (fs.existsSync(defaultGuidePath)) return fs.readFileSync(defaultGuidePath, 'utf8');
  return defaultGuide;
};

const secondsToUs = (seconds: number) => Math.max(0, Math.round(seconds * 1_000_000));

const postJson = async (url: string, body: unknown, timeoutMs = 120_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep text for diagnostics
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const code = typeof data === 'object' && data && 'code' in data ? (data as { code?: unknown }).code : 0;
    if (code !== 0) {
      throw new Error(`CapCut Mate returned code=${String(code)}: ${text.slice(0, 500)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const runProcess = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1200)}`));
    });
  });

const findFfmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const capcutMateMaxVideoMb = () => Number(process.env.CAPCUT_MATE_MAX_VIDEO_MB ?? '185');

const trimClip = async (
  inputPath: string,
  outputPath: string,
  start: number,
  end: number,
  transform: SecondaryEditTransform
) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const maxVideoBytes = capcutMateMaxVideoMb() * 1024 * 1024;
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024 && fs.statSync(outputPath).size <= maxVideoBytes) return;
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
  const duration = Math.max(0.5, end - start);
  const videoBitrateKbps = estimateVideoBitrateKbpsForCapcutLimit(duration, {
    maxFileMb: capcutMateMaxVideoMb(),
    audioKbps: 128,
    safetyRatio: 0.88,
    minVideoKbps: 2500,
    maxVideoKbps: 10000
  });
  const scaledWidth = even(1080 * transform.zoom);
  const scaledHeight = even(1920 * transform.zoom);
  const maxCropX = Math.max(0, scaledWidth - 1080);
  const maxCropY = Math.max(0, scaledHeight - 1920);
  const cropX = even(maxCropX * transform.cropX);
  const cropY = even(maxCropY * transform.cropY);
  await runProcess(findFfmpeg(), [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-ss',
    start.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    [
      `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`,
      `crop=1080:1920:${cropX}:${cropY}`,
      `eq=contrast=${transform.contrast.toFixed(3)}:saturation=${transform.saturation.toFixed(3)}:brightness=${transform.brightness.toFixed(3)}`,
      'fps=30',
      'format=yuv420p'
    ].join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    `${videoBitrateKbps}k`,
    '-maxrate',
    `${videoBitrateKbps}k`,
    '-bufsize',
    `${videoBitrateKbps * 2}k`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath
  ]);
  const outputSize = fs.statSync(outputPath).size;
  if (outputSize > maxVideoBytes) {
    throw new Error(
      `Trimmed clip exceeds capcut-mate file limit: ${(outputSize / 1024 / 1024).toFixed(1)}MB > ${capcutMateMaxVideoMb()}MB (${outputPath})`
    );
  }
};

const createStaticServer = (files: Map<string, string>) =>
  new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const id = decodeURIComponent(requestUrl.pathname.replace(/^\/file\//, ''));
      const filePath = files.get(id);
      if (!filePath || !fs.existsSync(filePath)) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'content-type': 'video/mp4' });
      fs.createReadStream(filePath).pipe(response);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind static file server'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((closeResolve, closeReject) => server.close((error) => (error ? closeReject(error) : closeResolve())))
      });
    });
  });

const episodeSource = (task: ReturnType<typeof normalizeShortDramaTask>, episodeNumber: number) => {
  const episode = task.mediaEpisodes.find((item) => item.episodeNumber === episodeNumber);
  if (!episode?.sourceVideo) throw new Error(`Episode ${episodeNumber} is missing sourceVideo`);
  if (!fs.existsSync(episode.sourceVideo)) throw new Error(`Episode ${episodeNumber} sourceVideo does not exist: ${episode.sourceVideo}`);
  return episode.sourceVideo;
};

const readSubtitleCuesByEpisode = (task: ReturnType<typeof normalizeShortDramaTask>) => {
  const cuesByEpisode = new Map<number, SubtitleCue[]>();
  for (const episode of task.mediaEpisodes) {
    if (!episode.transcriptPath || !fs.existsSync(episode.transcriptPath)) continue;
    const cues = parseSrtCues(fs.readFileSync(episode.transcriptPath, 'utf8'));
    if (cues.length > 0) cuesByEpisode.set(episode.episodeNumber, cues);
  }
  return cuesByEpisode;
};

async function executeVariant(input: {
  variant: EditPlanVariant;
  variantIndex: number;
  task: ReturnType<typeof normalizeShortDramaTask>;
  outputDir: string;
  capcutBaseUrl: string;
}): Promise<CapcutDraftResult> {
  const clips = new Map<string, string>();
  const clipRows: CapcutDraftResult['clips'] = [];
  const responses: Record<string, unknown>[] = [];
  let server: Awaited<ReturnType<typeof createStaticServer>> | undefined;

  try {
    const clipDir = path.join(input.outputDir, 'clips', input.variant.variantId);
    const usableTimeline = normalizeAiGeneratedTimelineForCapcut(input.variant.timeline, input.task.mediaEpisodes, {
      targetMinSeconds: 90,
      targetMaxSeconds: 180
    });
    if (usableTimeline.length === 0) {
      throw new Error(`Variant ${input.variant.variantId} has no executable AI timeline`);
    }
    for (const [index, segment] of usableTimeline.entries()) {
      const source = episodeSource(input.task, segment.episode);
      const clipPath = path.join(clipDir, `${String(index + 1).padStart(2, '0')}_ep${segment.episode}_${Math.round(segment.start)}_${Math.round(segment.end)}.mp4`);
      const secondaryEdit = secondaryEditTransformForSegment(index, input.variant.variantId);
      await trimClip(source, clipPath, segment.start, segment.end, secondaryEdit);
      const id = `${input.variant.variantId}_${index}`;
      clips.set(id, clipPath);
      clipRows.push({
        episode: segment.episode,
        sourceStart: segment.start,
        sourceEnd: segment.end,
        draftStart: segment.draftStart,
        draftEnd: segment.draftEnd,
        duration: segment.duration,
        secondaryEdit,
        clipPath
      });
    }

    server = await createStaticServer(clips);
    const createDraft = (await postJson(`${input.capcutBaseUrl}/openapi/capcut-mate/v1/create_draft`, {
      width: 1080,
      height: 1920
    })) as { draft_url?: string };
    responses.push({ createDraft });
    if (!createDraft.draft_url) throw new Error('create_draft did not return draft_url');

    let cursor = 0;
    const videoInfos = usableTimeline.map((segment, index) => {
      const duration = secondsToUs(segment.duration);
      const start = cursor;
      const end = cursor + duration;
      cursor = end;
      return {
        video_url: `${server?.baseUrl}/file/${encodeURIComponent(`${input.variant.variantId}_${index}`)}`,
        start,
        end,
        duration,
        volume: 1.0
      };
    });
    const addVideos = await postJson(`${input.capcutBaseUrl}/openapi/capcut-mate/v1/add_videos`, {
      draft_url: createDraft.draft_url,
      video_infos: JSON.stringify(videoInfos),
      scale_x: 1,
      scale_y: 1,
      transform_x: 0,
      transform_y: 0
    });
    responses.push({ addVideos });

    const englishCues = remapSrtCuesToTimeline(usableTimeline, readSubtitleCuesByEpisode(input.task));
    const subtitleFontSize = Number(process.env.APPOS_CAPCUT_SUBTITLE_FONT_SIZE ?? '14');
    const subtitleTransformY = Number(process.env.APPOS_CAPCUT_SUBTITLE_TRANSFORM_Y ?? '760');
    const englishCaptions = toCapcutCaptions(stabilizeCaptionsForDraft(englishCues), subtitleFontSize).slice(0, 500);
    if (englishCaptions.length > 0) {
      const addEnglishCaptions = await postJson(`${input.capcutBaseUrl}/openapi/capcut-mate/v1/add_captions`, {
        draft_url: createDraft.draft_url,
        captions: JSON.stringify(englishCaptions),
        text_color: '#ffffff',
        border_color: '#000000',
        alignment: 1,
        alpha: 1,
        font_size: subtitleFontSize,
        transform_y: subtitleTransformY,
        has_shadow: true,
        shadow_info: {
          shadow_color: '#000000',
          shadow_alpha: 0.95,
          shadow_diffuse: 18,
          shadow_distance: 5,
          shadow_angle: -45
        }
      });
      responses.push({ addEnglishCaptions, englishCaptionCount: englishCaptions.length });
    }

    const saveDraft = await postJson(`${input.capcutBaseUrl}/openapi/capcut-mate/v1/save_draft`, {
      draft_url: createDraft.draft_url
    });
    responses.push({ saveDraft });

    return {
      variantId: input.variant.variantId,
      variantName: input.variant.variantName,
      draftUrl: createDraft.draft_url,
      status: 'created',
      clips: clipRows,
      capcutResponses: responses
    };
  } catch (error) {
    return {
      variantId: input.variant.variantId,
      variantName: input.variant.variantName,
      status: 'failed',
      clips: clipRows,
      capcutResponses: responses,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (server) await server.close();
  }
}

export async function runPipeline(args: PipelineArgs) {
  loadRuntimeEnv();
  fs.mkdirSync(args.outputDir, { recursive: true });
  const payload = readJson(args.payloadPath);
  const task = normalizeShortDramaTask(payload);
  const guideText = readGuide(args.guidePath);

  const plan = args.planPath
    ? (readJson(args.planPath) as ShortDramaEditPlan)
    : await generateShortDramaEditPlan({
        task,
        guideText,
        difyWorkflowUrl: process.env.APPOS_DIFY_SHORT_DRAMA_CPS_WORKFLOW_URL || process.env.DIFY_SHORT_DRAMA_CPS_WORKFLOW_URL,
        difyApiKey: process.env.APPOS_DIFY_SHORT_DRAMA_CPS_API_KEY || process.env.DIFY_SHORT_DRAMA_CPS_API_KEY,
        difyUser: process.env.APPOS_DIFY_USER || 'tele-opc',
        deepseekApiKey: process.env.DEEPSEEK_API_KEY,
        deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
        deepseekModel: process.env.DEEPSEEK_MODEL
      });
  const validation = validateExecutableEditPlan(plan, task);
  const validationPath = path.join(args.outputDir, 'edit_plan_validation.json');
  writeJson(validationPath, validation);
  if (!validation.ok) {
    throw new Error(`Edit plan is not executable:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }
  const planPath = path.join(args.outputDir, 'edit_plan.json');
  writeJson(planPath, plan);

  const capcutBaseUrl = (process.env.CAPCUT_MATE_URL || 'http://127.0.0.1:30000').replace(/\/$/, '');
  const selectedVariantEntries = args.variantIndexes?.length
    ? args.variantIndexes
        .map((planIndex) => ({ planIndex, variant: plan.styleVariants[planIndex] }))
        .filter((entry): entry is { planIndex: number; variant: EditPlanVariant } => Boolean(entry.variant))
    : plan.styleVariants
        .slice(0, Math.max(1, args.maxVariants))
        .map((variant, planIndex) => ({ planIndex, variant }));
  const drafts: CapcutDraftResult[] = [];
  if (args.skipCapcut) {
    drafts.push(
      ...selectedVariantEntries.map(({ variant }) => ({
        variantId: variant.variantId,
        variantName: variant.variantName,
        status: 'skipped' as const,
        clips: [],
        capcutResponses: []
      }))
    );
  } else {
    for (const { planIndex, variant } of selectedVariantEntries) {
      drafts.push(await executeVariant({ variant, variantIndex: planIndex, task, outputDir: args.outputDir, capcutBaseUrl }));
    }
  }
  const draftsPath = path.join(args.outputDir, 'capcut_drafts.json');
  writeJson(draftsPath, drafts);

    const reviewCard = {
      type: 'short_drama_cps_review',
      productId: plan.productId,
      title: task.name || task.productId,
      ownerApprovalRequired: true,
      copyrightReviewRequired: true,
      secondaryEditPolicy: [
        'English subtitles only from transcriptPath SRT',
        'Dify/AI chooses hooks, episode cuts, and next-episode pre-hook setup placement',
        'Executor preserves the AI timeline and caps each cut to 90-180 seconds',
        'FFmpeg reframe/crop/zoom/color-pass/reencode applied before CapCut'
      ],
      plannerProvider: plan.plannerProvider,
      plannerDiagnostics: plan.sourceGuideNotes,
    variants: plan.styleVariants.map((variant) => ({
      variantId: variant.variantId,
      variantName: variant.variantName,
      platform: variant.platform,
      hook: variant.hook.text,
      durationSeconds: variant.durationSeconds,
      timeline: normalizeAiGeneratedTimelineForCapcut(variant.timeline, task.mediaEpisodes, {
        targetMinSeconds: 90,
        targetMaxSeconds: 180
      }).map((segment) => ({
        episode: segment.episode,
        start: segment.start,
        end: segment.end,
        draftStart: segment.draftStart,
        draftEnd: segment.draftEnd,
        purpose: segment.purpose,
        caption: segment.caption
      })),
      draftUrl: drafts.find((draft) => draft.variantId === variant.variantId)?.draftUrl,
      riskNotes: variant.riskNotes,
      publishCopy: variant.publishCopy
    })),
    outputs: { planPath, draftsPath }
  };
  const reviewCardPath = path.join(args.outputDir, 'review_card.json');
  writeJson(reviewCardPath, reviewCard);

  return { planPath, draftsPath, reviewCardPath, createdDrafts: drafts.filter((draft) => draft.status === 'created').length };
}

export async function main() {
  const result = await runPipeline(parseArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
