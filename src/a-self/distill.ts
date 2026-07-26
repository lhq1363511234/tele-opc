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
  You are an expert AI persona distillation engine. Your task is to dynamically distill the user's digital persona (A_profile) strictly based on their provided memories and decision logs.
  Do not use generic advice. Extract their actual behavioral patterns, value priorities, and communication style.

  ${dataContext}

  Return the result EXACTLY as a valid JSON object matching this structure (no markdown fences, just raw JSON):
  {
    "mission": "One sentence summarizing their core operational mission based on data.",
    "profile_markdown": "A short paragraph describing the persona's core vibe, worldview, and strategic focus.",
    "values_order": ["Value A > Value B", "Value C > Value D"],
    "decision_principles": ["Principle 1", "Principle 2", "Principle 3"],
    "boundaries": ["Strict boundary 1", "Strict boundary 2"],
    "communication_style": { "prefer": ["Style 1"], "avoid": ["Style 2"] }
  }
  `;

  try {
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'You are a precise data distillation engine. Output raw valid JSON only.' },
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
