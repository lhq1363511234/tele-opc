import { describe, expect, it } from 'vitest';
import {
  buildSequentialQuarterTimeline,
  estimateVideoBitrateKbpsForCapcutLimit,
  normalizeAiGeneratedTimelineForCapcut,
  parseSrtCues,
  remapSrtCuesToTimeline,
  stabilizeCaptionsForDraft,
  secondaryEditTransformForSegment,
  toCapcutCaptions
} from '../../src/appos/domains/cps/short-drama-capcut-prep.js';

describe('short drama capcut prep', () => {
  const cues = (rows: Array<[number, number, string]>) =>
    rows.map(([start, end, text]) => ({ start, end, text }));

  it('maps original English SRT cues onto the edited draft timeline', () => {
    const cues = parseSrtCues([
      '1',
      '00:00:02,500 --> 00:00:04,000',
      'Every year, we offer one girl to the sea.',
      '',
      '2',
      '00:00:07,500 --> 00:00:09,000',
      'The dragon is coming!',
      ''
    ].join('\n'));

    const timeline = [
      {
        episode: 1,
        start: 2,
        end: 8,
        draftStart: 0,
        draftEnd: 6,
        duration: 6,
        purpose: 'hook',
        caption: 'hook'
      }
    ];

    const mapped = remapSrtCuesToTimeline(timeline, new Map([[1, cues]]));
    expect(mapped).toEqual([
      { start: 0.5, end: 2, text: 'Every year, we offer one girl to the sea.' },
      { start: 5.5, end: 6, text: 'The dragon is coming!' }
    ]);

    expect(toCapcutCaptions(mapped, 18)).toEqual([
      { start: 500000, end: 2000000, text: 'Every year, we offer one girl to\nthe sea.', font_size: 18 },
      { start: 5500000, end: 6000000, text: 'The dragon is coming!', font_size: 18 }
    ]);
  });

  it('preserves an AI-generated cross-episode timeline with next-episode setup at the previous cut ending', () => {
    const timeline = normalizeAiGeneratedTimelineForCapcut(
      [
        { episode: 1, start: 0, end: 120, purpose: 'story_after_hook', caption: 'episode 1 hook story' },
        { episode: 2, start: 0, end: 24, purpose: 'next_episode_pre_hook_setup', caption: 'setup for episode 2 hook' }
      ],
      [
        { episodeNumber: 1, probe: { durationSeconds: 120 } },
        { episodeNumber: 2, probe: { durationSeconds: 140 } }
      ],
      { targetMinSeconds: 90, targetMaxSeconds: 180 }
    );

    expect(timeline.map((segment) => [segment.episode, segment.start, segment.end, segment.purpose, segment.draftStart, segment.draftEnd])).toEqual([
      [1, 0, 120, 'story_after_hook', 0, 120],
      [2, 0, 24, 'next_episode_pre_hook_setup', 120, 144]
    ]);
  });

  it('caps an AI-generated cut at 180 seconds without inventing fixed-count variants', () => {
    const timeline = normalizeAiGeneratedTimelineForCapcut(
      [{ episode: 1, start: 30, end: 390, purpose: 'story_after_hook', caption: 'AI chose the hook and story range' }],
      [{ episodeNumber: 1, probe: { durationSeconds: 390 } }],
      { targetMinSeconds: 90, targetMaxSeconds: 180 }
    );

    expect(timeline).toEqual([
      expect.objectContaining({ episode: 1, start: 30, end: 210, duration: 180, draftStart: 0, draftEnd: 180 })
    ]);
  });

  it('builds sequential 20-second chunks in episode order for a quarter slice', () => {
    const plan = buildSequentialQuarterTimeline(
      [
        { episodeNumber: 1, probe: { durationSeconds: 50 } },
        { episodeNumber: 2, probe: { durationSeconds: 50 } },
        { episodeNumber: 3, probe: { durationSeconds: 50 } },
        { episodeNumber: 4, probe: { durationSeconds: 50 } }
      ],
      { sliceIndex: 0, sliceCount: 4, chunkSeconds: 20 }
    );

    expect(plan.totalDuration).toBe(200);
    expect(plan.sliceStart).toBe(0);
    expect(plan.sliceEnd).toBe(50);
    expect(plan.segments.map((segment) => [segment.episode, segment.start, segment.end, segment.duration, segment.draftStart, segment.draftEnd])).toEqual([
      [1, 0, 20, 20, 0, 20],
      [1, 20, 40, 20, 20, 40],
      [1, 40, 50, 10, 40, 50]
    ]);
  });

  it('starts the next quarter slice from the next ordered episode window', () => {
    const plan = buildSequentialQuarterTimeline(
      [
        { episodeNumber: 1, probe: { durationSeconds: 30 } },
        { episodeNumber: 2, probe: { durationSeconds: 30 } },
        { episodeNumber: 3, probe: { durationSeconds: 30 } },
        { episodeNumber: 4, probe: { durationSeconds: 30 } }
      ],
      { sliceIndex: 1, sliceCount: 4, chunkSeconds: 20 }
    );

    expect(plan.sliceStart).toBe(30);
    expect(plan.sliceEnd).toBe(60);
    expect(plan.segments.map((segment) => [segment.episode, segment.start, segment.end])).toEqual([
      [2, 0, 20],
      [2, 20, 30]
    ]);
  });

  it('creates deterministic secondary-edit transforms instead of raw repost clips', () => {
    const first = secondaryEditTransformForSegment(0, 'high_burn_v1');
    const second = secondaryEditTransformForSegment(1, 'high_burn_v1');

    expect(first.techniques).toContain('reframe_crop_zoom');
    expect(first.techniques).toContain('color_contrast_pass');
    expect(first.techniques).toContain('non_keyframe_reencode');
    expect(first.zoom).toBeGreaterThan(1);
    expect(first.contrast).not.toBe(1);
    expect(second.cropX).not.toBe(first.cropX);
    expect(second.cropY).not.toBe(first.cropY);
  });

  it('estimates FFmpeg video bitrate below the capcut-mate single-file upload limit', () => {
    const bitrate = estimateVideoBitrateKbpsForCapcutLimit(141, {
      maxFileMb: 185,
      audioKbps: 128,
      safetyRatio: 0.88,
      minVideoKbps: 2500,
      maxVideoKbps: 10000
    });
    const estimatedBytes = ((bitrate + 128) * 1000 * 141) / 8;

    expect(bitrate).toBeGreaterThanOrEqual(9000);
    expect(bitrate).toBeLessThanOrEqual(9600);
    expect(estimatedBytes).toBeLessThan(185 * 1024 * 1024);
    expect(
      estimateVideoBitrateKbpsForCapcutLimit(20, {
        maxFileMb: 185,
        audioKbps: 128,
        safetyRatio: 0.88,
        minVideoKbps: 2500,
        maxVideoKbps: 10000
      })
    ).toBe(10000);
  });

  it('removes overlapping and non-dialogue subtitle cues before CapCut upload', () => {
    const stabilized = stabilizeCaptionsForDraft([
      { start: 0, end: 1.5, text: '(dramatic music)' },
      { start: 1.0, end: 2.5, text: 'He is coming.' },
      { start: 2.3, end: 3.2, text: 'Run!' },
      { start: 4.0, end: 4.6, text: '[MUSIC PLAYING]' }
    ]);

    expect(stabilized).toEqual([
      { start: 1, end: 2.299, text: 'He is coming.' },
      { start: 2.3, end: 3.2, text: 'Run!' }
    ]);
  });
});
