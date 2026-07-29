import type { Repositories } from '../db/repositories.js';
import type { AppConfig } from '../config/index.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';

export async function runPersonaDistillation(repos: Repositories, config: AppConfig, profileId?: string) {
  const provider = createModelProviderFromConfig(config);
  if (!provider) throw new Error('AI Provider not configured. Please configure an AI provider first.');

  const memories = await repos.listASelfMemoryItems(40);
  const decisions = await repos.listASelfDecisionLogs(40);
  const currentProfile = await repos.getASelfProfile();

  const dataContext = [
    '=== YOUR MEMORIES ===',
    ...memories.map(m => `[Memory] ${m.title}\nFacts: ${m.content}\nWhy/Delta: ${m.why || 'N/A'}\n`),
    '=== YOUR DECISIONS ===',
    ...decisions.map(d => `[Decision] Q: ${d.question}\nChoice: ${d.choice}\nWhy: ${d.why}\nRule Formed: ${d.future_rule || 'N/A'}\n`)
  ].join('\n');

  const prompt = `
  你是 Tele-OPC 的个人数字人格蒸馏器。你的任务是只根据下面的长期记忆和决策日志，动态蒸馏用户的数字本人（A_profile）。
  请用中文输出。不要给通用建议；只提取这个用户真实、稳定、可执行的行为模式、价值排序、决策方式和沟通风格。
  不要输出隐私原文、人名、手机号、微信号、密钥、公司私密信息；如果证据不足，降低置信度并写成边界/假设，不要编造。

  ${dataContext}

  Return the result EXACTLY as a valid JSON object matching this structure (no markdown fences, just raw JSON; all string values should be Chinese):
  {
    "mission": "用一句中文总结此人的核心行动使命。",
    "profile_markdown": "一段中文画像：核心气质、世界观、经营观、人际观和战略焦点。",
    "values_order": ["Value A > Value B", "Value C > Value D"],
    "decision_principles": ["中文原则 1", "中文原则 2", "中文原则 3"],
    "boundaries": ["中文严格边界 1", "中文严格边界 2"],
    "communication_style": { "prefer": ["中文风格 1"], "avoid": ["中文风格 2"] }
  }
  `;

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: '你是精确、谨慎、保护隐私的数据蒸馏器。只输出 raw valid JSON，所有字符串用中文。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    });

    const rawJson = (response.content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawJson);

    const updated = await repos.upsertASelfProfile({
      id: profileId || currentProfile?.id || 'a_self_default',
      displayName: currentProfile?.display_name || 'A- (Distilled)',
      mission: parsed.mission || '动态计算中的目标',
      profileMarkdown: parsed.profile_markdown || '',
      valuesOrder: Array.isArray(parsed.values_order) ? parsed.values_order : [],
      decisionPrinciples: Array.isArray(parsed.decision_principles) ? parsed.decision_principles : [],
      boundaries: Array.isArray(parsed.boundaries) ? parsed.boundaries : [],
      communicationStyle: typeof parsed.communication_style === 'object' ? parsed.communication_style : {},
      confidence: 0.95,
      metadata: { source: 'llm_distilled', lastDistilledAt: new Date().toISOString() }
    });

    return updated;
  } catch (err) {
    throw new Error(`Distillation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
