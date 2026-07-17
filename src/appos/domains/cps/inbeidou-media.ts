import path from 'node:path';
import type { MediaPreprocessOptions, MediaPreprocessReport } from '../../media/preprocess.js';
import { runMediaPreprocess } from '../../media/preprocess.js';
import type { NormalizedInbeidouTask } from './inbeidou.js';

export type InbeidouEpisodeVideo = {
  episodeNumber: number;
  kind: string;
  localPath: string;
  sourceUrl: string;
};

export type InbeidouMediaEpisode = {
  episodeNumber: number;
  video: InbeidouEpisodeVideo;
  analysisDir: string;
  transcriptPath: string;
  reportPath: string;
  report: MediaPreprocessReport;
};

export type InbeidouTaskWithMedia = NormalizedInbeidouTask & {
  mediaEpisodes: InbeidouMediaEpisode[];
};

type MediaPreprocessRunner = (options: MediaPreprocessOptions) => MediaPreprocessReport;

const episodeNumberFromText = (value: string) => {
  const text = value.trim();
  const explicit = text.match(/episode[_ -]?video[_ -]?(\d{1,3})/i) ?? text.match(/\b(?:ep|e)\s*(\d{1,3})\b/i);
  if (explicit) return Number(explicit[1]);
  const digits = [...text.matchAll(/(\d{1,3})/g)].map((match) => Number(match[1]));
  return digits.length === 1 ? digits[0] : null;
};

export function collectDownloadedEpisodeVideos(task: NormalizedInbeidouTask): InbeidouEpisodeVideo[] {
  const episodes = task.downloadedFiles
    .map((file) => {
      const kind = String(file.kind ?? '');
      const localPath = String(file.localPath ?? '');
      const sourceUrl = String(file.sourceUrl ?? '');
      const candidate = episodeNumberFromText(`${kind} ${path.basename(localPath)}`);
      const normalizedKind = kind.toLowerCase();
      if (!candidate) return null;
      if (!normalizedKind.includes('video') && !normalizedKind.includes('episode')) return null;
      if (!localPath) return null;
      return {
        episodeNumber: candidate,
        kind,
        localPath,
        sourceUrl
      } satisfies InbeidouEpisodeVideo;
    })
    .filter((item): item is InbeidouEpisodeVideo => Boolean(item));

  return episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export function enrichTaskWithMedia(
  task: NormalizedInbeidouTask,
  options: {
    outputDir: string;
    whisperModelPath?: string;
    whisperCliPath?: string;
    whisperCliModel?: string;
    whisperCliTimeoutMs?: number;
    sampleCount?: number;
    language?: string;
    preprocess?: MediaPreprocessRunner;
  }
): InbeidouTaskWithMedia {
  const preprocess = options.preprocess ?? runMediaPreprocess;
  const language = options.language ?? task.language ?? 'en';
  const mediaEpisodes = collectDownloadedEpisodeVideos(task).map((video) => {
    const analysisDir = path.join(options.outputDir, task.productId, `ep${video.episodeNumber}`);
    const report = preprocess({
      inputPath: video.localPath,
      outputDir: analysisDir,
      sampleCount: options.sampleCount,
      whisperModelPath: options.whisperModelPath,
      whisperCliPath: options.whisperCliPath,
      whisperCliModel: options.whisperCliModel,
      whisperCliTimeoutMs: options.whisperCliTimeoutMs,
      language
    });
    return {
      episodeNumber: video.episodeNumber,
      video,
      analysisDir,
      transcriptPath: report.asr.transcriptPath,
      reportPath: report.outputs.reportPath,
      report
    } satisfies InbeidouMediaEpisode;
  });

  return {
    ...task,
    mediaEpisodes
  };
}
