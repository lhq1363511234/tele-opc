export type ShortDramaEpisode = {
  episodeNumber: number;
  sourceMaterialId?: string;
  subtitleMaterialId?: string;
  sourceVideo?: string;
  transcriptPath?: string;
  transcriptText?: string;
  reportPath?: string;
  probe?: unknown;
  quality?: unknown;
  screenshots?: unknown;
};

export type ShortDramaTask = {
  productId: string;
  taskId?: string;
  name?: string;
  chName?: string;
  platform?: string;
  commissionRate?: number;
  promoCopy?: string;
  promoLinks?: Record<string, { serial?: string; app?: string; copy?: string }>;
  mediaEpisodes: ShortDramaEpisode[];
  constraints?: string[];
};

export type EditTimelineSegment = {
  episode: number;
  start: number;
  end: number;
  purpose: string;
  caption: string;
};

export type EditPlanVariant = {
  variantId: string;
  variantName: string;
  platform: string;
  aspectRatio: '9:16';
  durationSeconds: number;
  hook: {
    text: string;
    sourceEpisode: number;
    start: number;
    end: number;
  };
  timeline: EditTimelineSegment[];
  voiceover: Array<{ start: number; end: number; text: string }>;
  captions: Array<{ start: number; end: number; text: string }>;
  bgm: { mood: string; volume: number };
  publishCopy: { title: string; caption: string; hashtags: string[] };
  riskNotes: string[];
  capcut: {
    draftName: string;
    canvas: 'vertical_9_16';
    sourceMaterialIds: string[];
    subtitleMaterialIds: string[];
  };
};

export type ShortDramaEditPlan = {
  editPlanId: string;
  productId: string;
  plannerProvider: 'dify-workflow' | 'deepseek-direct' | 'heuristic-fallback';
  styleVariants: EditPlanVariant[];
  ownerApprovalRequired: true;
  qaChecklist: string[];
  sourceGuideNotes: string[];
};

type FetchLike = typeof fetch;

const asString = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const compactTranscript = (text: string | undefined, max = 1800) => {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.floor(max * 0.65))} ... ${normalized.slice(-Math.floor(max * 0.25))}`;
};

const seconds = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = asString(value).match(/durationSeconds[=:]\s*([0-9.]+)/);
  return match ? Number(match[1]) : fallback;
};

const executableDurationSeconds = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  const duration = Number.isFinite(numeric) && numeric > 0 ? numeric : 90;
  return Math.min(Math.max(duration, 90), 180);
};

const hasMojibake = (value: string) => /�|鐭|榫|鍓|绛|楂|悬|娴|涓|濂|绁|鑱|�/.test(value);

const readableVariantName = (variantId: string, variantName: unknown, index: number) => {
  const rawName = asString(variantName).trim();
  if (rawName && !hasMojibake(rawName)) return rawName;
  const order = variantId.match(/_(\d+)$/)?.[1] ?? String(index + 1).padStart(3, '0');
  if (variantId.startsWith('high_burn')) return `高燃冲突版 ${order}`;
  if (variantId.startsWith('suspense')) return `悬念反转版 ${order}`;
  if (variantId.startsWith('narration')) return `解说引导版 ${order}`;
  return `剪辑版本 ${order}`;
};

export function normalizeShortDramaTask(payload: unknown): ShortDramaTask {
  const root = payload as { tasks?: ShortDramaTask[] };
  const task = root.tasks?.[0];
  if (!task) throw new Error('Payload does not contain tasks[0]');
  if (!task.productId) throw new Error('Task is missing productId');
  if (!Array.isArray(task.mediaEpisodes) || task.mediaEpisodes.length === 0) {
    throw new Error('Task is missing mediaEpisodes');
  }
  return task;
}

export function buildPlannerContext(task: ShortDramaTask, guideText: string) {
  return {
    product: {
      productId: task.productId,
      taskId: task.taskId,
      name: task.name,
      chName: task.chName,
      platform: task.platform,
      commissionRate: task.commissionRate,
      promoCopy: compactTranscript(task.promoCopy, 1200),
      promoLinks: task.promoLinks,
      constraints: task.constraints ?? []
    },
    guide: compactTranscript(guideText, 1800),
    episodes: task.mediaEpisodes.map((episode) => ({
      episodeNumber: episode.episodeNumber,
      sourceMaterialId: episode.sourceMaterialId,
      subtitleMaterialId: episode.subtitleMaterialId,
      sourceVideo: episode.sourceVideo,
      transcriptPath: episode.transcriptPath,
      reportPath: episode.reportPath,
      durationSeconds: seconds(episode.probe, 90),
      probe: asString(episode.probe).slice(0, 600),
      quality: asString(episode.quality).slice(0, 600),
      transcriptText: compactTranscript(episode.transcriptText, 2000)
    }))
  };
}

const requiredJsonShape = `{
  "editPlanId": "plan_xxx",
  "productId": "string",
  "styleVariants": [
    {
      "variantId": "high_burn_001",
      "variantName": "高燃冲突版 001",
      "platform": "facebook",
      "aspectRatio": "9:16",
      "durationSeconds": 144,
      "hook": {"text": "The dragon is coming! Run!", "sourceEpisode": 2, "start": 24, "end": 27},
      "timeline": [
        {"episode": 2, "start": 24, "end": 27, "purpose": "hook", "caption": "Exact 3-second opening hook from transcript cue"},
        {"episode": 2, "start": 27, "end": 36, "purpose": "story_after_hook", "caption": "Immediate reaction after hook"},
        {"episode": 2, "start": 44, "end": 55, "purpose": "conflict_escalation", "caption": "Escalate conflict with a new cut"},
        {"episode": 3, "start": 0, "end": 12, "purpose": "next_episode_pre_hook_setup", "caption": "Move setup before episode 3 hook to this cut ending"}
      ],
      "voiceover": [{"start": 0, "end": 5, "text": "English optional narration or guide text"}],
      "captions": [{"start": 0, "end": 3, "text": "English top hook caption"}],
      "bgm": {"mood": "dramatic", "volume": 0.18},
      "publishCopy": {"title": "", "caption": "", "hashtags": []},
      "riskNotes": [],
      "capcut": {
        "draftName": "",
        "canvas": "vertical_9_16",
        "sourceMaterialIds": [],
        "subtitleMaterialIds": []
      }
    },
    {"variantId": "suspense_001", "variantName": "悬念反转版 001", "platform": "facebook", "aspectRatio": "9:16", "durationSeconds": 144, "hook": {"text": "string", "sourceEpisode": 1, "start": 0, "end": 3}, "timeline": [], "voiceover": [], "captions": [], "bgm": {"mood": "suspense", "volume": 0.16}, "publishCopy": {"title": "", "caption": "", "hashtags": []}, "riskNotes": [], "capcut": {"draftName": "", "canvas": "vertical_9_16", "sourceMaterialIds": [], "subtitleMaterialIds": []}},
    {"variantId": "narration_001", "variantName": "解说引导版 001", "platform": "facebook", "aspectRatio": "9:16", "durationSeconds": 144, "hook": {"text": "string", "sourceEpisode": 1, "start": 0, "end": 3}, "timeline": [], "voiceover": [], "captions": [], "bgm": {"mood": "story_commentary", "volume": 0.14}, "publishCopy": {"title": "", "caption": "", "hashtags": []}, "riskNotes": [], "capcut": {"draftName": "", "canvas": "vertical_9_16", "sourceMaterialIds": [], "subtitleMaterialIds": []}}
  ],
  "ownerApprovalRequired": true,
  "qaChecklist": [],
  "sourceGuideNotes": []
}`;
const extractJson = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        objects.push(candidate.slice(start, index + 1));
        start = -1;
      }
    }
  }
  if (objects.length === 0) {
    throw new Error('Planner response did not contain a JSON object');
  }
  const parsed = objects
    .map((objectText) => {
      try {
        return { objectText, value: JSON.parse(objectText) as unknown };
      } catch {
        return null;
      }
    })
    .filter((item): item is { objectText: string; value: unknown } => Boolean(item));
  const editPlan = parsed.find((item) => {
    const value = item.value as { styleVariants?: unknown; editPlanId?: unknown };
    return Array.isArray(value?.styleVariants) || typeof value?.editPlanId === 'string';
  });
  return editPlan?.objectText ?? parsed[0]?.objectText ?? objects[0];
};

function normalizePlan(raw: unknown, task: ShortDramaTask, provider: ShortDramaEditPlan['plannerProvider']): ShortDramaEditPlan {
  const plan = raw as Partial<ShortDramaEditPlan>;
  const variants = Array.isArray(plan.styleVariants) ? plan.styleVariants : [];
  if (variants.length === 0) throw new Error('Planner returned no styleVariants');
  return {
    editPlanId: plan.editPlanId || `plan_${task.productId}_${Date.now()}`,
    productId: plan.productId || task.productId,
    plannerProvider: provider,
    styleVariants: variants.map((variant, index) => {
      const variantId = variant.variantId || `variant_${index + 1}`;
      const variantName = readableVariantName(variantId, variant.variantName, index);
      return {
        variantId,
        variantName,
        platform: variant.platform || 'douyin',
        aspectRatio: '9:16',
        durationSeconds: executableDurationSeconds(variant.durationSeconds),
        hook: {
          text: variant.hook?.text || '前三秒必须交代冲突、危险和反转。',
          sourceEpisode: Number(variant.hook?.sourceEpisode || 1),
          start: Number(variant.hook?.start || 0),
          end: Number(variant.hook?.end || 3)
        },
        timeline: (variant.timeline || []).map((segment) => ({
          episode: Number(segment.episode || 1),
          start: Number(segment.start || 0),
          end: Math.max(Number(segment.end || 0), Number(segment.start || 0) + 8),
          purpose: segment.purpose || 'plot',
          caption: segment.caption || ''
        })),
        voiceover: variant.voiceover || [],
        captions: variant.captions || [],
        bgm: variant.bgm || { mood: 'dramatic', volume: 0.18 },
        publishCopy: variant.publishCopy || { title: '', caption: '', hashtags: [] },
        riskNotes: variant.riskNotes || [],
        capcut: {
          draftName: variant.capcut?.draftName || `${task.name || task.productId}_${variantId}`,
          canvas: 'vertical_9_16',
          sourceMaterialIds: variant.capcut?.sourceMaterialIds || task.mediaEpisodes.map((e) => e.sourceMaterialId || '').filter(Boolean),
          subtitleMaterialIds: variant.capcut?.subtitleMaterialIds || task.mediaEpisodes.map((e) => e.subtitleMaterialId || '').filter(Boolean)
        }
      };
    }),
    ownerApprovalRequired: true,
    qaChecklist: plan.qaChecklist || [
      '前三秒是否有明确冲突或反转',
      '是否避开明显违规镜头和过度亲密表达',
      '字幕、旁白、推广链接是否与平台匹配',
      '发布前必须老板确认'
    ],
    sourceGuideNotes: plan.sourceGuideNotes || []
  };
}

export async function generateShortDramaEditPlan(input: {
  task: ShortDramaTask;
  guideText: string;
  difyWorkflowUrl?: string;
  difyApiKey?: string;
  difyUser?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  fetch?: FetchLike;
}): Promise<ShortDramaEditPlan> {
  const context = buildPlannerContext(input.task, input.guideText);
  let difyFallbackNote: string | undefined;
  try {
    const difyPlan = await tryDifyWorkflow({
      context,
      task: input.task,
      workflowUrl: input.difyWorkflowUrl,
      apiKey: input.difyApiKey,
      user: input.difyUser,
      fetch: input.fetch
    });
    if (difyPlan) return difyPlan;
  } catch (error) {
    difyFallbackNote = `Dify workflow fallback: ${error instanceof Error ? error.message : String(error)}`;
  }

  const apiKey = input.deepseekApiKey?.trim();
  if (!apiKey) {
    const plan = createHeuristicPlan(input.task, 'heuristic-fallback');
    if (difyFallbackNote) plan.sourceGuideNotes = [difyFallbackNote, ...plan.sourceGuideNotes];
    return plan;
  }

  const fetchImpl = input.fetch ?? fetch;
  const baseUrl = (input.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = input.deepseekModel || 'deepseek-v4-flash';
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是短剧 CPS 矩阵剪辑策划 Dify 工作流的核心节点。只输出 JSON，不输出 Markdown。目标是让 n8n 和 CapCut Mate 可直接执行。'
          },
          {
            role: 'user',
            content: [
              'Generate three complete full-series editing strategies: high_burn_conflict, suspense_reversal, and narration_guided. Each strategy must cut from the first useful opening through the final episode.',
              'For each strategy, generate as many styleVariants/cuts as needed to cover the drama through the final episode. Do not stop after one cut.',
              'Use variantId names that show the strategy and order, such as high_burn_001, suspense_001, narration_001.',
              'For every episode, AI must judge whether it is a normal story episode, montage, recap, trailer, or low-signal material. Do not assume episode 1 is montage.',
              'For each normal story episode, the cut that starts that episode should start exactly at the strongest AI-selected hook. If material before that hook should be preserved and a previous cut exists, place it at the ending of the previous cut as next_episode_pre_hook_setup.',
              'If an episode is montage/recap/trailer-like, mark that in purpose/caption and make a secondary-edit enhancement plan instead of forcing a story hook cut.',
              'Each executable cut should target 90-180 seconds. The executor will cap cuts at 180 seconds, so keep the timeline coherent inside that range.',
              'Video subtitles must be English only. Use transcriptPath SRT subtitles in the CapCut execution layer; do not require Chinese subtitles in the draft.',
              'The three strategies may reuse source material, but each strategy must have its own hooks, timeline decisions, captions, voiceover or guide text, publishCopy, riskNotes, and secondary-edit packaging focus.',
              'Copyright/secondary-edit rule for every cut: preserve story continuity while applying reframed crop/zoom, color pass, re-encoding, subtitle cleanup, top hook caption, and explicit copyright risk notes for human review.',
              'Each styleVariant timeline must be a real EDL, not one copied whole episode. The first timeline segment MUST exactly match hook.sourceEpisode/hook.start/hook.end and should be 2-5 seconds.',
              'Use subtitle-cue-based semantic segments to reach the target duration. Segment lengths are dynamic, but do not output a single raw-copy segment that simply spans most of an episode.',
              'Each executable cut must contain multiple meaningful timeline segments. The executor rejects one-long-segment raw repost plans.',
              'timeline segments must reference real episode/start/end seconds and should use purposes such as hook, story_after_hook, conflict_escalation, reaction_cut, next_episode_pre_hook_setup, montage_secondary_enhancement, cliffhanger_close, or continuation.',
              '根据北斗智影任务、字幕、媒体分析和剪辑指南，由 AI 自主决定钩子、切点、视频数量和覆盖顺序。',
              '必须输出三套完整全剧策略：高燃冲突版、悬念反转版、解说引导版。每套策略都要从头剪到尾，并各自生成足够多的 cuts。',
              '每个可执行 cut 目标 90-180 秒，但 timeline 不能整集复制；片段长度由字幕语义、冲突点、反转点和对白节奏决定，首片段必须严格等于 hook。',
              '要输出旁白、屏幕字幕、平台文案、标签、风险点、CapCut 草稿信息。',
              '不要自动发布，ownerApprovalRequired 必须为 true。',
              `JSON 结构必须符合：${requiredJsonShape}`,
              `输入上下文：${JSON.stringify(context)}`
            ].join('\n\n')
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek planner failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek planner returned empty content');
    const plan = normalizePlan(JSON.parse(extractJson(content)), input.task, 'deepseek-direct');
    if (difyFallbackNote) plan.sourceGuideNotes = [difyFallbackNote, ...plan.sourceGuideNotes];
    return plan;
  } catch (error) {
    const plan = createHeuristicPlan(input.task, 'heuristic-fallback');
    plan.sourceGuideNotes = [
      ...(difyFallbackNote ? [difyFallbackNote] : []),
      `DeepSeek direct fallback: ${error instanceof Error ? error.message : String(error)}`,
      ...plan.sourceGuideNotes
    ];
    return plan;
  }
}

async function tryDifyWorkflow(input: {
  context: ReturnType<typeof buildPlannerContext>;
  task: ShortDramaTask;
  workflowUrl?: string;
  apiKey?: string;
  user?: string;
  fetch?: FetchLike;
}) {
  const workflowUrl = input.workflowUrl?.trim();
  const apiKey = input.apiKey?.trim();
  if (!workflowUrl || !apiKey) return undefined;

  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(workflowUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      inputs: {
        product_json: JSON.stringify(input.context.product),
        episodes_json: JSON.stringify(input.context.episodes),
        guide_text: input.context.guide,
        required_json_shape: requiredJsonShape
      },
      response_mode: 'blocking',
      user: input.user || 'tele-opc'
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dify workflow planner failed: HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as { data?: { outputs?: Record<string, unknown> } };
  const outputs = data.data?.outputs;
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new Error('Dify workflow planner output malformed');
  }

  const candidate = outputs.edit_plan ?? outputs.editPlan ?? outputs.plan ?? outputs.result;
  if (!candidate) throw new Error('Dify workflow planner did not return edit_plan');
  const rawPlan = typeof candidate === 'string' ? JSON.parse(extractJson(candidate)) : candidate;
  return normalizePlan(rawPlan, input.task, 'dify-workflow');
}

export function createHeuristicPlan(
  task: ShortDramaTask,
  provider: ShortDramaEditPlan['plannerProvider'] = 'heuristic-fallback'
): ShortDramaEditPlan {
  const byEpisode = new Map(task.mediaEpisodes.map((episode) => [episode.episodeNumber, episode]));
  const capcutIds = {
    sourceMaterialIds: task.mediaEpisodes.map((e) => e.sourceMaterialId || '').filter(Boolean),
    subtitleMaterialIds: task.mediaEpisodes.map((e) => e.subtitleMaterialId || '').filter(Boolean)
  };
  const segment = (episode: number, start: number, end: number, purpose: string, caption: string): EditTimelineSegment => {
    const duration = seconds(byEpisode.get(episode)?.probe, 180);
    return { episode, start: Math.max(0, start), end: Math.min(Math.max(end, start + 8), duration), purpose, caption };
  };
  const styles = [
    {
      prefix: 'high_burn',
      name: '高燃冲突版',
      platform: 'facebook',
      mood: 'dramatic_high_burn',
      volume: 0.18,
      packaging: 'conflict-first packaging'
    },
    {
      prefix: 'suspense',
      name: '悬念反转版',
      platform: 'facebook',
      mood: 'suspense',
      volume: 0.16,
      packaging: 'reversal and cliffhanger packaging'
    },
    {
      prefix: 'narration',
      name: '解说引导版',
      platform: 'facebook',
      mood: 'story_commentary',
      volume: 0.14,
      packaging: 'narration-guided packaging'
    }
  ];
  const sortedEpisodes = [...task.mediaEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const variants: EditPlanVariant[] = styles.flatMap((style) =>
    sortedEpisodes.map((episode, index) => {
      const duration = seconds(episode.probe, 120);
      const end = Math.min(Math.max(duration, 8), 180);
      const order = String(index + 1).padStart(3, '0');
      const title = task.name || task.productId;
      return {
        variantId: `${style.prefix}_${order}`,
        variantName: `${style.name} ${order}`,
        platform: style.platform,
        aspectRatio: '9:16' as const,
        durationSeconds: end,
        hook: {
          text: 'AI planning unavailable; rerun Dify or DeepSeek to select the strongest transcript-based hook.',
          sourceEpisode: episode.episodeNumber,
          start: 0,
          end: Math.min(3, end)
        },
        timeline: [
          segment(
            episode.episodeNumber,
            0,
            end,
            index === 0 ? 'requires_ai_hook_selection' : 'requires_ai_continuation_selection',
            `${style.name}: placeholder cut for episode ${episode.episodeNumber}; ${style.packaging}; rerun AI planner before CapCut execution.`
          )
        ],
        voiceover: [
          {
            start: 0,
            end: Math.min(5, end),
            text: 'AI planning is required before final voiceover generation.'
          }
        ],
        captions: [
          {
            start: 0,
            end: Math.min(3, end),
            text: 'AI-selected English hook required'
          }
        ],
        bgm: { mood: style.mood, volume: style.volume },
        publishCopy: {
          title: `${title} ${style.name} ${order}`,
          caption: 'Draft placeholder. Rerun Dify/DeepSeek planner before publishing.',
          hashtags: ['#ShortDrama', '#CPS']
        },
        riskNotes: [
          'AI planning unavailable: do not publish this placeholder as final strategy.',
          'Run Dify or DeepSeek to choose hook, continuity, captions, and copyright-safe secondary-edit notes from transcript and media analysis.'
        ],
        capcut: { draftName: `${title}_${style.name}_${order}`, canvas: 'vertical_9_16' as const, ...capcutIds }
      };
    })
  );

  return {
    editPlanId: `plan_${task.productId}_${Date.now()}`,
    productId: task.productId,
    plannerProvider: provider,
    styleVariants: variants,
    ownerApprovalRequired: true,
    qaChecklist: ['Dify/DeepSeek 已生成真实钩子后再进入 CapCut', '检查英文字幕遮挡', '检查推广链接', '老板确认后再发布'],
    sourceGuideNotes: [
      'AI planning unavailable: this fallback only preserves the three fixed styles and full episode coverage.',
      'Do not treat heuristic-fallback as a final edit strategy.',
      'Expected AI styles: high_burn, suspense, narration.'
    ]
  };
}
