import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDramaRun,
  validateExecutableEditPlan,
  type DramaRunInputPayload
} from '../../src/appos/domains/cps/drama-run.js';
import type { ShortDramaEditPlan } from '../../src/appos/domains/cps/short-drama-edit-planner.js';

const payload = (platform: string, taskId: string): DramaRunInputPayload => ({
  sourcePlatform: platform,
  tasks: [
    {
      productId: `cps_${platform}_${taskId}`,
      taskId,
      name: 'The Lost Heiress Came Back',
      platform: 'facebook',
      mediaEpisodes: [1, 2].map((episodeNumber) => ({
        episodeNumber,
        sourceVideo: `B:/runs/source/ep${episodeNumber}.mp4`,
        transcriptPath: `B:/runs/source/ep${episodeNumber}.srt`,
        transcriptText: `Episode ${episodeNumber} conflict hook and story.`,
        probe: { durationSeconds: 120 }
      }))
    }
  ]
});

const validPlan = (): ShortDramaEditPlan => ({
  editPlanId: 'plan_valid',
  productId: 'cps_moboboost_51447322',
  plannerProvider: 'deepseek-direct',
  ownerApprovalRequired: true,
  qaChecklist: [],
  sourceGuideNotes: [],
  styleVariants: ['high_burn', 'suspense', 'narration'].map((prefix) => ({
    variantId: `${prefix}_001`,
    variantName: `${prefix} 001`,
    platform: 'facebook',
    aspectRatio: '9:16',
    durationSeconds: 96,
    hook: { text: `${prefix} hook`, sourceEpisode: 1, start: 12, end: 15 },
    timeline: [
      { episode: 1, start: 12, end: 15, purpose: 'hook', caption: '3-second hook' },
      { episode: 1, start: 15, end: 24, purpose: 'story_after_hook', caption: 'reaction' },
      { episode: 1, start: 36, end: 48, purpose: 'conflict_escalation', caption: 'conflict' },
      { episode: 2, start: 0, end: 9, purpose: 'next_episode_pre_hook_setup', caption: 'setup' }
    ],
    voiceover: [],
    captions: [],
    bgm: { mood: prefix, volume: 0.16 },
    publishCopy: { title: prefix, caption: prefix, hashtags: ['#ShortDrama'] },
    riskNotes: [],
    capcut: { draftName: prefix, canvas: 'vertical_9_16', sourceMaterialIds: [], subtitleMaterialIds: [] }
  }))
});

describe('drama run', () => {
  it('creates a platform-agnostic run manifest without hard-coded drama paths', () => {
    const run = buildDramaRun(payload('moboboost', '51447322'), {
      runtimeRoot: 'B:/Cir/CodexProjects/tele-opc/runtime/runs',
      now: new Date('2026-06-28T01:02:03.000Z')
    });

    expect(run.manifest.runId).toBe('moboboost_51447322_20260628T010203000Z');
    expect(run.manifest.sourcePlatform).toBe('moboboost');
    expect(run.manifest.episodeCount).toBe(2);
    expect(run.manifest.directories.analysis).toBe(
      path.join('B:/Cir/CodexProjects/tele-opc/runtime/runs', run.manifest.runId, 'analysis')
    );
    expect(run.planningPayload.tasks?.[0]?.mediaEpisodes.map((episode) => episode.sourceVideo)).toEqual([
      'B:/runs/source/ep1.mp4',
      'B:/runs/source/ep2.mp4'
    ]);
  });

  it('changes run id and directory when the selected platform or drama changes', () => {
    const first = buildDramaRun(payload('moboboost', '51447322'), {
      runtimeRoot: 'runtime/runs',
      now: new Date('2026-06-28T01:02:03.000Z')
    });
    const second = buildDramaRun(payload('inbeidou', '2075159024'), {
      runtimeRoot: 'runtime/runs',
      now: new Date('2026-06-28T01:02:03.000Z')
    });

    expect(first.manifest.runId).not.toBe(second.manifest.runId);
    expect(first.runDir).not.toBe(second.runDir);
  });

  it('rejects edit plans that copy a whole episode instead of an actual edited EDL', () => {
    const plan = validPlan();
    const firstVariant = plan.styleVariants[0];
    if (!firstVariant) throw new Error('missing first variant');
    firstVariant.timeline = [{ episode: 1, start: 0, end: 120, purpose: 'story_after_hook', caption: 'raw copy' }];

    const task = payload('moboboost', '51447322').tasks?.[0];
    if (!task) throw new Error('missing task');
    const result = validateExecutableEditPlan(plan, task);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('too few timeline segments');
    expect(result.errors.join('\n')).toContain('raw-copy-like segment');
  });

  it('requires each fixed style to start with the selected three-second hook', () => {
    const plan = validPlan();
    const secondVariant = plan.styleVariants[1];
    if (!secondVariant) throw new Error('missing second variant');
    secondVariant.timeline[0] = { episode: 1, start: 0, end: 10, purpose: 'story_after_hook', caption: 'missed hook' };

    const task = payload('moboboost', '51447322').tasks?.[0];
    if (!task) throw new Error('missing task');
    const result = validateExecutableEditPlan(plan, task);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('does not start with its hook');
  });

  it('accepts a multi-cut, hook-first plan for the three required styles', () => {
    const task = payload('moboboost', '51447322').tasks?.[0];
    if (!task) throw new Error('missing task');
    const result = validateExecutableEditPlan(validPlan(), task);

    expect(result).toEqual({ ok: true, errors: [] });
  });
});
