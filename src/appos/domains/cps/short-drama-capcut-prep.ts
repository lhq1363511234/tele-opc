import type { EditTimelineSegment, ShortDramaEpisode } from './short-drama-edit-planner.js';

export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type CapcutTimelineSegment = EditTimelineSegment & {
  draftStart: number;
  draftEnd: number;
  duration: number;
};

export type EpisodeDurationSource = Pick<ShortDramaEpisode, 'episodeNumber' | 'probe'>;

export type CapcutCaptionItem = {
  start: number;
  end: number;
  text: string;
  font_size: number;
};

export type SecondaryEditTransform = {
  techniques: string[];
  zoom: number;
  cropX: number;
  cropY: number;
  contrast: number;
  saturation: number;
  brightness: number;
};

export type SequentialSlicePlan = {
  totalDuration: number;
  sliceStart: number;
  sliceEnd: number;
  chunkSeconds: number;
  segments: CapcutTimelineSegment[];
};

const roundSeconds = (value: number) => Number(value.toFixed(3));

const secondsToUs = (seconds: number) => Math.max(0, Math.round(seconds * 1_000_000));

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function estimateVideoBitrateKbpsForCapcutLimit(
  durationSeconds: number,
  options: {
    maxFileMb?: number;
    audioKbps?: number;
    safetyRatio?: number;
    minVideoKbps?: number;
    maxVideoKbps?: number;
  } = {}
) {
  const duration = Math.max(1, durationSeconds);
  const maxFileMb = options.maxFileMb ?? 185;
  const audioKbps = options.audioKbps ?? 128;
  const safetyRatio = options.safetyRatio ?? 0.88;
  const minVideoKbps = options.minVideoKbps ?? 2500;
  const maxVideoKbps = options.maxVideoKbps ?? 10000;
  const totalKbps = (maxFileMb * 1024 * 1024 * 8) / 1000 / duration;
  const videoKbps = Math.floor((totalKbps - audioKbps) * safetyRatio);
  return clamp(videoKbps, minVideoKbps, maxVideoKbps);
}

const probeDurationSeconds = (probe: unknown, fallback: number) => {
  if (probe && typeof probe === 'object' && !Array.isArray(probe)) {
    const duration = (probe as { durationSeconds?: unknown }).durationSeconds;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  }
  if (typeof probe === 'string') {
    const match = probe.match(/durationSeconds[=:]\s*([0-9.]+)/);
    if (match) return Number(match[1]);
  }
  return fallback;
};

const buildEpisodeWindows = (episodes: EpisodeDurationSource[], fallbackDuration: number) => {
  const sorted = [...episodes]
    .map((episode) => ({
      episodeNumber: episode.episodeNumber,
      duration: probeDurationSeconds(episode.probe, fallbackDuration)
    }))
    .filter((episode) => episode.duration > 0)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  let cursor = 0;
  return sorted.map((episode) => {
    const start = cursor;
    const end = cursor + episode.duration;
    cursor = end;
    return { ...episode, start, end };
  });
};

const parseSrtTimecode = (value: string) => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  if (!match) throw new Error(`Invalid SRT timecode: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] || '0').padEnd(3, '0').slice(0, 3));
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export function parseSrtCues(srtText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = srtText.replace(/\r/g, '').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() || '';
    const match = line.match(
      /^(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})/
    );

    if (!match) {
      index += 1;
      continue;
    }

    const start = parseSrtTimecode(match[1] || '');
    const end = parseSrtTimecode(match[2] || '');
    index += 1;

    const textLines: string[] = [];
    while (index < lines.length && (lines[index]?.trim() || '') !== '') {
      textLines.push(lines[index] || '');
      index += 1;
    }

    const text = textLines.join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text && end > start) cues.push({ start: roundSeconds(start), end: roundSeconds(end), text });
  }

  return cues;
}

export function buildSequentialQuarterTimeline(
  episodes: EpisodeDurationSource[],
  options: {
    sliceIndex?: number;
    sliceCount?: number;
    chunkSeconds?: number;
    fallbackEpisodeDurationSeconds?: number;
  } = {}
): SequentialSlicePlan {
  const sliceCount = Math.max(1, options.sliceCount ?? 4);
  const sliceIndex = Math.min(Math.max(0, options.sliceIndex ?? 0), sliceCount - 1);
  const chunkSeconds = Math.max(1, options.chunkSeconds ?? 20);
  const fallbackDuration = options.fallbackEpisodeDurationSeconds ?? 180;
  const episodeWindows = buildEpisodeWindows(episodes, fallbackDuration);
  const totalDuration = roundSeconds(episodeWindows.reduce((sum, episode) => sum + episode.duration, 0));
  if (totalDuration <= 0 || episodeWindows.length === 0) {
    return { totalDuration: 0, sliceStart: 0, sliceEnd: 0, chunkSeconds, segments: [] };
  }

  const sliceSize = totalDuration / sliceCount;
  const sliceStart = roundSeconds(sliceIndex * sliceSize);
  const sliceEnd = roundSeconds(sliceIndex === sliceCount - 1 ? totalDuration : Math.min(totalDuration, sliceStart + sliceSize));
  const segments: CapcutTimelineSegment[] = [];

  const findEpisodeAt = (seriesTime: number) => episodeWindows.find((episode) => seriesTime >= episode.start && seriesTime < episode.end);

  let seriesCursor = sliceStart;
  while (seriesCursor < sliceEnd - 0.0005) {
    const episode = findEpisodeAt(seriesCursor);
    if (!episode) break;

    const remainingSeries = sliceEnd - seriesCursor;
    const remainingEpisode = episode.end - seriesCursor;
    const duration = roundSeconds(Math.min(chunkSeconds, remainingSeries, remainingEpisode));
    if (duration <= 0) {
      seriesCursor = roundSeconds(episode.end);
      continue;
    }

    const sourceStart = roundSeconds(seriesCursor - episode.start);
    const sourceEnd = roundSeconds(sourceStart + duration);
    segments.push({
      episode: episode.episodeNumber,
      start: sourceStart,
      end: sourceEnd,
      purpose: 'sequential_episode_slice',
      caption: 'ordered cut',
      draftStart: 0,
      draftEnd: 0,
      duration
    });
    seriesCursor = roundSeconds(seriesCursor + duration);
  }

  let draftCursor = 0;
  const draftedSegments = segments.map((segment) => {
    const draftStart = roundSeconds(draftCursor);
    const draftEnd = roundSeconds(draftCursor + segment.duration);
    draftCursor = draftEnd;
    return { ...segment, draftStart, draftEnd };
  });

  return { totalDuration, sliceStart, sliceEnd, chunkSeconds, segments: draftedSegments };
}

export function normalizeTimelineForCapcut(
  timeline: EditTimelineSegment[],
  episodes: EpisodeDurationSource[],
  options: {
    minSegmentSeconds?: number;
    maxSegmentSeconds?: number;
    targetMinTotalSeconds?: number;
    fallbackEpisodeDurationSeconds?: number;
  } = {}
): CapcutTimelineSegment[] {
  const minSegmentSeconds = options.minSegmentSeconds ?? 8;
  const maxSegmentSeconds = Math.max(minSegmentSeconds, options.maxSegmentSeconds ?? 30);
  const targetMinTotalSeconds = options.targetMinTotalSeconds ?? 60;
  const fallbackDuration = options.fallbackEpisodeDurationSeconds ?? 180;
  const durationByEpisode = new Map(
    episodes.map((episode) => [episode.episodeNumber, probeDurationSeconds(episode.probe, fallbackDuration)])
  );
  const sortedEpisodes = [...episodes]
    .map((episode) => ({
      episodeNumber: episode.episodeNumber,
      duration: probeDurationSeconds(episode.probe, fallbackDuration)
    }))
    .filter((episode) => episode.duration > 0)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  const segments = timeline
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .map((segment) => {
      const episodeDuration = durationByEpisode.get(segment.episode) ?? Math.max(segment.end, fallbackDuration);
      let start = clamp(segment.start, 0, episodeDuration);
      let end = clamp(Math.max(segment.end, start + minSegmentSeconds), 0, episodeDuration);

      if (end - start < minSegmentSeconds && end > 0) {
        start = Math.max(0, end - minSegmentSeconds);
      }

      return {
        ...segment,
        start: roundSeconds(start),
        end: roundSeconds(end),
        draftStart: 0,
        draftEnd: 0,
        duration: roundSeconds(Math.max(0, end - start))
      };
    })
    .filter((segment) => segment.duration > 0.2);

  let totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (totalDuration < targetMinTotalSeconds) {
    for (const segment of segments) {
      if (totalDuration >= targetMinTotalSeconds) break;
      const episodeDuration = durationByEpisode.get(segment.episode) ?? Math.max(segment.end, fallbackDuration);
      const upperBound = Math.min(episodeDuration, segment.start + maxSegmentSeconds);
      const spare = Math.max(0, upperBound - segment.end);
      const extension = Math.min(spare, targetMinTotalSeconds - totalDuration);
      if (extension <= 0) continue;
      segment.end = roundSeconds(segment.end + extension);
      segment.duration = roundSeconds(segment.end - segment.start);
      totalDuration += extension;
    }
  }

  if (totalDuration < targetMinTotalSeconds) {
    const usedWindows = new Map<number, Array<{ start: number; end: number }>>();
    for (const segment of segments) {
      const windows = usedWindows.get(segment.episode) ?? [];
      windows.push({ start: segment.start, end: segment.end });
      usedWindows.set(segment.episode, windows);
    }

    for (const episode of sortedEpisodes) {
      if (totalDuration >= targetMinTotalSeconds) break;
      const windows = (usedWindows.get(episode.episodeNumber) ?? []).sort((a, b) => a.start - b.start);
      const candidates: Array<{ start: number; end: number }> = [];
      let cursor = 0;
      for (const window of windows) {
        if (window.start - cursor >= minSegmentSeconds) candidates.push({ start: cursor, end: window.start });
        cursor = Math.max(cursor, window.end);
      }
      if (episode.duration - cursor >= minSegmentSeconds) candidates.push({ start: cursor, end: episode.duration });

      for (const candidate of candidates) {
        if (totalDuration >= targetMinTotalSeconds) break;
        const remaining = targetMinTotalSeconds - totalDuration;
        const duration = Math.min(maxSegmentSeconds, remaining, candidate.end - candidate.start);
        if (duration < minSegmentSeconds) continue;
        const start = roundSeconds(candidate.start);
        const end = roundSeconds(candidate.start + duration);
        const segment: CapcutTimelineSegment = {
          episode: episode.episodeNumber,
          start,
          end,
          draftStart: 0,
          draftEnd: 0,
          duration: roundSeconds(end - start),
          purpose: 'auto_continuation',
          caption: 'auto continuation'
        };
        segments.push(segment);
        totalDuration += segment.duration;
      }
    }
  }

  let cursor = 0;
  return segments.map((segment) => {
    const draftStart = roundSeconds(cursor);
    const draftEnd = roundSeconds(cursor + segment.duration);
    cursor = draftEnd;
    return { ...segment, draftStart, draftEnd };
  });
}

export function normalizeAiGeneratedTimelineForCapcut(
  timeline: EditTimelineSegment[],
  episodes: EpisodeDurationSource[],
  options: {
    targetMinSeconds?: number;
    targetMaxSeconds?: number;
    fallbackEpisodeDurationSeconds?: number;
  } = {}
): CapcutTimelineSegment[] {
  const targetMinSeconds = options.targetMinSeconds ?? 90;
  const targetMaxSeconds = Math.max(targetMinSeconds, options.targetMaxSeconds ?? 180);
  const fallbackDuration = options.fallbackEpisodeDurationSeconds ?? 180;
  const durationByEpisode = new Map(
    episodes.map((episode) => [episode.episodeNumber, probeDurationSeconds(episode.probe, fallbackDuration)])
  );

  const cleaned = timeline
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .map((segment) => {
      const episodeDuration = durationByEpisode.get(segment.episode) ?? Math.max(segment.end, fallbackDuration);
      const start = roundSeconds(clamp(segment.start, 0, episodeDuration));
      const end = roundSeconds(clamp(segment.end, start, episodeDuration));
      return {
        ...segment,
        start,
        end,
        draftStart: 0,
        draftEnd: 0,
        duration: roundSeconds(end - start)
      };
    })
    .filter((segment) => segment.duration > 0.2);

  if (cleaned.length === 0) return [];

  const total = cleaned.reduce((sum, segment) => sum + segment.duration, 0);
  if (total < targetMinSeconds) {
    const last = cleaned[cleaned.length - 1];
    if (last) {
      const episodeDuration = durationByEpisode.get(last.episode) ?? Math.max(last.end, fallbackDuration);
      const extension = Math.min(targetMinSeconds - total, episodeDuration - last.end);
      if (extension > 0) {
        last.end = roundSeconds(last.end + extension);
        last.duration = roundSeconds(last.end - last.start);
      }
    }
  }

  const capped: CapcutTimelineSegment[] = [];
  let keptSeconds = 0;
  for (const segment of cleaned) {
    if (keptSeconds >= targetMaxSeconds) break;
    const remaining = roundSeconds(targetMaxSeconds - keptSeconds);
    const duration = Math.min(segment.duration, remaining);
    if (duration <= 0.2) break;
    capped.push({
      ...segment,
      end: roundSeconds(segment.start + duration),
      duration: roundSeconds(duration)
    });
    keptSeconds = roundSeconds(keptSeconds + duration);
  }

  let cursor = 0;
  return capped.map((segment) => {
    const draftStart = roundSeconds(cursor);
    const draftEnd = roundSeconds(cursor + segment.duration);
    cursor = draftEnd;
    return { ...segment, draftStart, draftEnd };
  });
}

export function remapSrtCuesToTimeline(
  timeline: Array<Pick<CapcutTimelineSegment, 'episode' | 'start' | 'end' | 'draftStart' | 'draftEnd'>>,
  cuesByEpisode: Map<number, SubtitleCue[]>,
  options: { minCueSeconds?: number } = {}
): SubtitleCue[] {
  const minCueSeconds = options.minCueSeconds ?? 0.15;
  const captions: SubtitleCue[] = [];

  for (const segment of timeline) {
    const cues = cuesByEpisode.get(segment.episode) ?? [];
    for (const cue of cues) {
      const overlapStart = Math.max(cue.start, segment.start);
      const overlapEnd = Math.min(cue.end, segment.end);
      if (overlapEnd - overlapStart < minCueSeconds) continue;

      const start = roundSeconds(segment.draftStart + overlapStart - segment.start);
      const end = roundSeconds(Math.min(segment.draftEnd, segment.draftStart + overlapEnd - segment.start));
      if (end - start >= minCueSeconds) captions.push({ start, end, text: cue.text });
    }
  }

  return captions.sort((a, b) => a.start - b.start || a.end - b.end);
}

const isDialogueCue = (text: string) => {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/^[\[(].*[\])]$/.test(normalized)) return false;
  if (/^(music|upbeat music|dramatic music|screaming|laughing)$/i.test(normalized)) return false;
  return true;
};

export function stabilizeCaptionsForDraft(cues: SubtitleCue[], minGapSeconds = 0.001): SubtitleCue[] {
  const filtered = cues
    .filter((cue) => cue.end > cue.start && isDialogueCue(cue.text))
    .map((cue) => ({ start: roundSeconds(cue.start), end: roundSeconds(cue.end), text: cue.text.trim() }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const stabilized: SubtitleCue[] = [];
  for (let i = 0; i < filtered.length; i += 1) {
    const current = { ...filtered[i] };
    const next = filtered[i + 1];
    if (next && current.end > next.start) {
      current.end = roundSeconds(Math.max(current.start, next.start - minGapSeconds));
    }
    if (current.end > current.start) stabilized.push(current);
  }

  return stabilized;
}

export function toCapcutCaptions(cues: SubtitleCue[], fontSize: number): CapcutCaptionItem[] {
  return cues
    .filter((cue) => cue.text.trim() && cue.end > cue.start)
    .map((cue) => ({
      start: secondsToUs(cue.start),
      end: secondsToUs(cue.end),
      text: wrapEnglishSubtitle(cue.text),
      font_size: fontSize
    }));
}

const wrapEnglishSubtitle = (text: string, maxLineLength = 34) => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLineLength || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  if (lines.length <= 2) return lines.join('\n');
  return `${lines[0]}\n${lines.slice(1).join(' ')}`;
};

export function secondaryEditTransformForSegment(index: number, variantId = ''): SecondaryEditTransform {
  const seed = Array.from(variantId).reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 17;
  const zoomSteps = [1.06, 1.09, 1.12, 1.08];
  const cropXs = [0.18, 0.5, 0.72, 0.35];
  const cropYs = [0.12, 0.32, 0.58, 0.42];
  const contrastSteps = [1.04, 1.08, 1.06, 1.1];
  const saturationSteps = [1.06, 1.1, 1.08, 1.12];
  const pick = (values: number[]) => values[Math.abs(seed) % values.length] || values[0] || 1;

  return {
    techniques: ['reframe_crop_zoom', 'color_contrast_pass', 'non_keyframe_reencode'],
    zoom: pick(zoomSteps),
    cropX: pick(cropXs),
    cropY: pick(cropYs),
    contrast: pick(contrastSteps),
    saturation: pick(saturationSteps),
    brightness: index % 2 === 0 ? 0.01 : -0.005
  };
}
