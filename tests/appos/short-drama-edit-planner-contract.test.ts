import { describe, expect, it } from 'vitest';
import {
  createHeuristicPlan,
  generateShortDramaEditPlan,
  type ShortDramaTask
} from '../../src/appos/domains/cps/short-drama-edit-planner.js';

const multiEpisodeTask: ShortDramaTask = {
  productId: 'cps_moboboost_demo',
  name: 'The Lost Heiress Came Back',
  platform: 'facebook',
  mediaEpisodes: [1, 2, 3, 4, 5].map((episodeNumber) => ({
    episodeNumber,
    sourceMaterialId: `mat_ep${episodeNumber}`,
    subtitleMaterialId: `sub_ep${episodeNumber}`,
    sourceVideo: `B:/materials/ep${episodeNumber}.mp4`,
    transcriptText: `Episode ${episodeNumber}: English dialogue with conflict and reversal.`,
    probe: { durationSeconds: 120 }
  }))
};

const planWithThreeStrategies = {
  editPlanId: 'plan_contract',
  productId: 'cps_moboboost_demo',
  styleVariants: ['high_burn', 'suspense', 'narration'].map((prefix, index) => ({
    variantId: `${prefix}_001`,
    variantName: `${prefix} 001`,
    platform: 'facebook',
    durationSeconds: 120,
    hook: { text: `${prefix} hook`, sourceEpisode: index + 1, start: 0, end: 3 },
    timeline: [{ episode: index + 1, start: 0, end: 120, purpose: 'story_after_hook', caption: `${prefix} cut` }],
    voiceover: [],
    captions: [],
    bgm: { mood: prefix, volume: 0.16 },
    publishCopy: { title: prefix, caption: prefix, hashtags: ['#ShortDrama'] },
    riskNotes: ['copyright review required'],
    capcut: { draftName: prefix, canvas: 'vertical_9_16', sourceMaterialIds: [], subtitleMaterialIds: [] }
  })),
  ownerApprovalRequired: true,
  qaChecklist: [],
  sourceGuideNotes: []
};

describe('short drama edit planner contract', () => {
  it('uses deepseek-v4-flash as the default direct planner model', async () => {
    const seenModels: string[] = [];

    await generateShortDramaEditPlan({
      task: multiEpisodeTask,
      guideText: 'Generate three fixed full-series CPS edit strategies.',
      deepseekApiKey: 'test-key',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        seenModels.push(body.model);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(planWithThreeStrategies) } }]
          }),
          { status: 200 }
        );
      }
    });

    expect(seenModels).toEqual(['deepseek-v4-flash']);
  });

  it('normalizes AI variant durations into the executable 90-180 second range', async () => {
    const shortPlan = {
      ...planWithThreeStrategies,
      styleVariants: [
        {
          ...planWithThreeStrategies.styleVariants[0],
          durationSeconds: 60,
          timeline: [{ episode: 1, start: 0, end: 60, purpose: 'story_after_hook', caption: 'short cut' }]
        }
      ]
    };

    const result = await generateShortDramaEditPlan({
      task: multiEpisodeTask,
      guideText: 'Cuts must be executable.',
      deepseekApiKey: 'test-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(shortPlan) } }]
          }),
          { status: 200 }
        )
    });

    expect(result.styleVariants[0]?.durationSeconds).toBe(90);
  });

  it('accepts Dify edit_plan strings that include think tags and trailing diagnostics', async () => {
    const difyPlan = {
      ...planWithThreeStrategies,
      styleVariants: planWithThreeStrategies.styleVariants.map((variant) => ({
        ...variant,
        variantName: variant.variantId.startsWith('high_burn') ? '��ȼ��ͻ�� 001' : variant.variantName
      }))
    };
    const result = await generateShortDramaEditPlan({
      task: multiEpisodeTask,
      guideText: 'Dify may include provider artifacts around JSON.',
      difyWorkflowUrl: 'http://127.0.0.1:5001/v1/workflows/run',
      difyApiKey: 'dify-test-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: {
              outputs: {
                edit_plan: `<think>internal reasoning must be ignored</think>${JSON.stringify(difyPlan)}\n{"diagnostics":"ignore"}`
              }
            }
          }),
          { status: 200 }
        )
    });

    expect(result.plannerProvider).toBe('dify-workflow');
    expect(result.editPlanId).toBe('plan_contract');
    expect(result.styleVariants).toHaveLength(3);
    expect(result.styleVariants[0]?.variantName).toBe('高燃冲突版 001');
  });

  it('falls back to heuristic output when DeepSeek direct returns malformed JSON', async () => {
    const result = await generateShortDramaEditPlan({
      task: multiEpisodeTask,
      guideText: 'Malformed direct planner output should not crash the pipeline.',
      difyWorkflowUrl: 'http://127.0.0.1:5001/v1/workflows/run',
      difyApiKey: 'dify-test-key',
      deepseekApiKey: 'deepseek-test-key',
      deepseekBaseUrl: 'https://api.deepseek.test',
      fetch: async (url) => {
        if (String(url).includes('127.0.0.1')) {
          return new Response(JSON.stringify({ code: 'invalid_param', message: 'Dify unavailable' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"styleVariants":[{"publishCopy":{"hashtags":[#bad]}}]}' } }]
          }),
          { status: 200 }
        );
      }
    });

    expect(result.plannerProvider).toBe('heuristic-fallback');
    expect(result.sourceGuideNotes.some((note) => note.includes('Dify workflow fallback'))).toBe(true);
    expect(result.sourceGuideNotes.some((note) => note.includes('DeepSeek direct fallback'))).toBe(true);
  });

  it('fallback planning never fabricates a fixed plot and still covers every episode for each fixed style', () => {
    const plan = createHeuristicPlan(multiEpisodeTask);
    const serialized = JSON.stringify(plan);

    expect(serialized).not.toContain('龙王');
    expect(serialized).not.toContain('DragonKing');
    expect(serialized).not.toContain('献祭');
    expect(plan.sourceGuideNotes.join('\n')).toContain('AI planning unavailable');

    for (const prefix of ['high_burn', 'suspense', 'narration']) {
      const coveredEpisodes = new Set(
        plan.styleVariants
          .filter((variant) => variant.variantId.startsWith(prefix))
          .flatMap((variant) => variant.timeline.map((segment) => segment.episode))
      );
      expect([...coveredEpisodes].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
