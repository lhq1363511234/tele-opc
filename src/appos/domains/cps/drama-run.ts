import fs from 'node:fs';
import path from 'node:path';
import type { EditPlanVariant, ShortDramaEditPlan, ShortDramaTask } from './short-drama-edit-planner.js';
import { normalizeShortDramaTask } from './short-drama-edit-planner.js';

export type DramaRunInputPayload = {
  sourcePlatform?: string;
  tasks?: ShortDramaTask[];
  [key: string]: unknown;
};

export type DramaRunManifest = {
  runId: string;
  sourcePlatform: string;
  productId: string;
  taskId: string;
  dramaName: string;
  episodeCount: number;
  createdAt: string;
  directories: {
    root: string;
    downloads: string;
    analysis: string;
    planning: string;
    drafts: string;
    exports: string;
  };
  episodes: Array<{
    episodeNumber: number;
    sourceVideo?: string;
    transcriptPath?: string;
    reportPath?: string;
    durationSeconds: number;
  }>;
};

export type DramaRun = {
  runDir: string;
  manifest: DramaRunManifest;
  planningPayload: DramaRunInputPayload;
};

export type EditPlanValidationResult = {
  ok: boolean;
  errors: string[];
};

const timestampForRunId = (date: Date) => date.toISOString().replace(/[-:.]/g, '');

const safeIdPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

const durationSeconds = (probe: unknown) => {
  if (probe && typeof probe === 'object' && !Array.isArray(probe)) {
    const duration = (probe as { durationSeconds?: unknown }).durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  }
  if (typeof probe === 'string') {
    const match = probe.match(/durationSeconds[=:]\s*([0-9.]+)/);
    if (match) return Number(match[1]);
  }
  return 0;
};

const clonePayload = (payload: DramaRunInputPayload): DramaRunInputPayload => JSON.parse(JSON.stringify(payload));

export function buildDramaRun(
  payload: DramaRunInputPayload,
  options: {
    runtimeRoot?: string;
    now?: Date;
  } = {}
): DramaRun {
  const now = options.now ?? new Date();
  const runtimeRoot = path.resolve(options.runtimeRoot ?? 'runtime/runs');
  const clonedPayload = clonePayload(payload);
  const task = normalizeShortDramaTask(clonedPayload);
  const sourcePlatform = safeIdPart(payload.sourcePlatform || task.platform || 'unknown_platform');
  const taskId = safeIdPart(task.taskId || task.productId);
  const runId = `${sourcePlatform}_${taskId}_${timestampForRunId(now)}`;
  const runDir = path.join(runtimeRoot, runId);
  const directories = {
    root: runDir,
    downloads: path.join(runDir, 'downloads'),
    analysis: path.join(runDir, 'analysis'),
    planning: path.join(runDir, 'planning'),
    drafts: path.join(runDir, 'drafts'),
    exports: path.join(runDir, 'exports')
  };

  const manifest: DramaRunManifest = {
    runId,
    sourcePlatform,
    productId: task.productId,
    taskId: task.taskId || task.productId,
    dramaName: task.name || task.chName || task.productId,
    episodeCount: task.mediaEpisodes.length,
    createdAt: now.toISOString(),
    directories,
    episodes: [...task.mediaEpisodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((episode) => ({
        episodeNumber: episode.episodeNumber,
        sourceVideo: episode.sourceVideo,
        transcriptPath: episode.transcriptPath,
        reportPath: episode.reportPath,
        durationSeconds: durationSeconds(episode.probe)
      }))
  };

  const planningTask = normalizeShortDramaTask(clonedPayload);
  planningTask.constraints = [
    ...(planningTask.constraints ?? []),
    'Use this DramaRun manifest; do not rely on hard-coded file paths, episode count, or platform-specific assumptions.',
    'AI must generate hook-first, multi-cut EDL variants from the actual transcript cues for this selected drama.'
  ];
  (clonedPayload as { dramaRun?: DramaRunManifest }).dramaRun = manifest;

  return {
    runDir,
    manifest,
    planningPayload: clonedPayload
  };
}

export function materializeDramaRun(run: DramaRun) {
  for (const dir of Object.values(run.manifest.directories)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const manifestPath = path.join(run.runDir, 'drama_manifest.json');
  const planningPayloadPath = path.join(run.manifest.directories.planning, 'dify_short_drama_cps_payload.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(run.manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(planningPayloadPath, `${JSON.stringify(run.planningPayload, null, 2)}\n`, 'utf8');
  return { manifestPath, planningPayloadPath };
}

const strategyPrefix = (variantId: string) => {
  if (variantId.startsWith('high_burn')) return 'high_burn';
  if (variantId.startsWith('suspense')) return 'suspense';
  if (variantId.startsWith('narration')) return 'narration';
  return '';
};

const variantDuration = (variant: EditPlanVariant) =>
  variant.timeline.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);

export function validateExecutableEditPlan(
  plan: ShortDramaEditPlan,
  task: ShortDramaTask,
  options: {
    requiredStyles?: string[];
    minSegmentsPerVariant?: number;
    hookToleranceSeconds?: number;
    rawCopyRatioThreshold?: number;
  } = {}
): EditPlanValidationResult {
  const requiredStyles = options.requiredStyles ?? ['high_burn', 'suspense', 'narration'];
  const minSegmentsPerVariant = options.minSegmentsPerVariant ?? 3;
  const hookToleranceSeconds = options.hookToleranceSeconds ?? 0.75;
  const rawCopyRatioThreshold = options.rawCopyRatioThreshold ?? 0.8;
  const errors: string[] = [];
  const episodeNumbers = new Set(task.mediaEpisodes.map((episode) => episode.episodeNumber));
  const durationByEpisode = new Map(task.mediaEpisodes.map((episode) => [episode.episodeNumber, durationSeconds(episode.probe)]));

  for (const style of requiredStyles) {
    if (!plan.styleVariants.some((variant) => strategyPrefix(variant.variantId) === style)) {
      errors.push(`missing required style: ${style}`);
    }
  }

  for (const variant of plan.styleVariants) {
    if (!variant.timeline.length) {
      errors.push(`${variant.variantId}: empty timeline`);
      continue;
    }

    if (variant.timeline.length < minSegmentsPerVariant) {
      errors.push(`${variant.variantId}: too few timeline segments (${variant.timeline.length} < ${minSegmentsPerVariant})`);
    }

    const first = variant.timeline[0];
    if (
      !first ||
      first.episode !== variant.hook.sourceEpisode ||
      Math.abs(first.start - variant.hook.start) > hookToleranceSeconds ||
      Math.abs(first.end - variant.hook.end) > hookToleranceSeconds
    ) {
      errors.push(`${variant.variantId}: timeline does not start with its hook`);
    }

    const hookLength = Math.max(0, variant.hook.end - variant.hook.start);
    if (hookLength < 2 || hookLength > 5) {
      errors.push(`${variant.variantId}: hook must be a 2-5 second opening cue, got ${hookLength.toFixed(3)}s`);
    }

    for (const segment of variant.timeline) {
      if (!episodeNumbers.has(segment.episode)) {
        errors.push(`${variant.variantId}: unknown episode ${segment.episode}`);
      }
      const length = segment.end - segment.start;
      if (length <= 0) {
        errors.push(`${variant.variantId}: non-positive segment ${segment.episode}:${segment.start}-${segment.end}`);
      }
      const episodeDuration = durationByEpisode.get(segment.episode) ?? 0;
      if (episodeDuration > 0 && length / episodeDuration >= rawCopyRatioThreshold) {
        errors.push(
          `${variant.variantId}: raw-copy-like segment (${length.toFixed(3)}s is ${(length / episodeDuration * 100).toFixed(1)}% of episode ${segment.episode})`
        );
      }
    }

    const total = variantDuration(variant);
    if (total < 30) {
      errors.push(`${variant.variantId}: total executable duration too short (${total.toFixed(3)}s)`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
