import { describe, expect, it } from 'vitest';
import { generateShortDramaEditPlan, type ShortDramaTask } from '../../src/appos/domains/cps/short-drama-edit-planner.js';

const sampleTask: ShortDramaTask = {
  productId: 'cps_demo_001',
  name: '测试短剧',
  platform: 'douyin',
  mediaEpisodes: [
    {
      episodeNumber: 1,
      sourceMaterialId: 'mat_ep1',
      subtitleMaterialId: 'sub_ep1',
      sourceVideo: 'B:\\media\\ep1.mp4',
      transcriptText: '女主被迫参加献祭，龙王出现，剧情出现反转。'
    }
  ]
};

describe('short drama edit planner', () => {
  it('uses a configured Dify workflow before falling back to direct model calls', async () => {
    const calls: string[] = [];
    const result = await generateShortDramaEditPlan({
      task: sampleTask,
      guideText: '黄金三段：高能开场 -> 完整叙事 -> 引流转化收尾。',
      difyWorkflowUrl: 'http://127.0.0.1:5001/v1/workflows/run',
      difyApiKey: 'dify-test-key',
      fetch: async (url, init) => {
        calls.push(String(url));
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer dify-test-key');
        return new Response(
          JSON.stringify({
            workflow_run_id: 'dify_run_short_drama_001',
            data: {
              outputs: {
                edit_plan: {
                  editPlanId: 'plan_from_dify',
                  productId: 'cps_demo_001',
                  styleVariants: [
                    {
                      variantId: 'golden_three_v1',
                      variantName: '黄金三段版',
                      platform: 'douyin',
                      aspectRatio: '9:16',
                      durationSeconds: 90,
                      hook: { text: '她以为自己是祭品，下一秒龙王认出了她。', sourceEpisode: 1, start: 0, end: 3 },
                      timeline: [{ episode: 1, start: 0, end: 12, purpose: 'golden_3s_hook', caption: '她不是祭品' }],
                      voiceover: [{ start: 0, end: 4, text: '所有人都以为她会死。' }],
                      captions: [{ start: 0, end: 3, text: '龙王认出她了' }],
                      bgm: { mood: 'dramatic', volume: 0.18 },
                      publishCopy: { title: '龙王认出祭品', caption: '看完整版', hashtags: ['短剧'] },
                      riskNotes: ['发布前检查亲密表达'],
                      capcut: { draftName: '测试短剧_黄金三段版', canvas: 'vertical_9_16', sourceMaterialIds: ['mat_ep1'], subtitleMaterialIds: ['sub_ep1'] }
                    }
                  ],
                  ownerApprovalRequired: true,
                  qaChecklist: ['老板确认后再发布'],
                  sourceGuideNotes: ['黄金三段']
                }
              }
            }
          }),
          { status: 200 }
        );
      }
    });

    expect(calls).toEqual(['http://127.0.0.1:5001/v1/workflows/run']);
    expect(result.plannerProvider).toBe('dify-workflow');
    expect(result.editPlanId).toBe('plan_from_dify');
    expect(result.styleVariants[0]?.variantName).toBe('黄金三段版');
  });

  it('falls back to direct DeepSeek planning when local Dify workflow cannot run', async () => {
    const calls: string[] = [];
    const result = await generateShortDramaEditPlan({
      task: sampleTask,
      guideText: '高燃混剪和爆点引流。',
      difyWorkflowUrl: 'http://127.0.0.1:5001/v1/workflows/run',
      difyApiKey: 'dify-test-key',
      deepseekApiKey: 'deepseek-test-key',
      deepseekBaseUrl: 'https://api.deepseek.test',
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).includes('127.0.0.1')) {
          return new Response(JSON.stringify({ code: 'invalid_param', message: 'Failed to request plugin daemon' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    editPlanId: 'plan_from_deepseek_fallback',
                    productId: 'cps_demo_001',
                    styleVariants: [
                      {
                        variantId: 'high_burn_v1',
                        variantName: '高燃版',
                        platform: 'douyin',
                        durationSeconds: 90,
                        hook: { text: '献祭现场反转。', sourceEpisode: 1, start: 0, end: 3 },
                        timeline: [{ episode: 1, start: 0, end: 10, purpose: 'hook', caption: '反转来了' }],
                        voiceover: [],
                        captions: [],
                        bgm: { mood: 'dramatic', volume: 0.18 },
                        publishCopy: { title: '反转', caption: '看完整版', hashtags: [] },
                        riskNotes: [],
                        capcut: { draftName: 'fallback', canvas: 'vertical_9_16', sourceMaterialIds: [], subtitleMaterialIds: [] }
                      }
                    ],
                    ownerApprovalRequired: true,
                    qaChecklist: [],
                    sourceGuideNotes: []
                  })
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
    });

    expect(calls).toEqual(['http://127.0.0.1:5001/v1/workflows/run', 'https://api.deepseek.test/chat/completions']);
    expect(result.plannerProvider).toBe('deepseek-direct');
    expect(result.editPlanId).toBe('plan_from_deepseek_fallback');
    expect(result.sourceGuideNotes.some((note) => note.includes('Dify workflow fallback'))).toBe(true);
  });
});
