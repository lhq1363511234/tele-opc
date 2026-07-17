import { describe, expect, it } from 'vitest';
import { buildQuoteDraft, parsePricingRules, renderQuoteDraft } from '../src/quote/quoteEngine.js';
import type { MemoryRecord } from '../src/types.js';

describe('quoteEngine', () => {
  it('parses Chinese pricing rules from imported text', () => {
    const rules = parsePricingRules('价格表：网站维护套餐 3000 元/月；企业版 12000 元/年；AI 自动化顾问 2 万元/项目');

    expect(rules).toEqual([
      expect.objectContaining({
        serviceName: '网站维护套餐',
        amount: 3000,
        currency: 'CNY',
        unit: '月'
      }),
      expect.objectContaining({
        serviceName: '企业版',
        amount: 12000,
        currency: 'CNY',
        unit: '年'
      }),
      expect.objectContaining({
        serviceName: 'AI 自动化顾问',
        amount: 20000,
        currency: 'CNY',
        unit: '项目'
      })
    ]);
  });

  it('builds a quote draft from pricing memory', () => {
    const draft = buildQuoteDraft('给 Acme 出网站维护套餐报价', [
      pricingMemory('价格表：网站维护套餐 3000 元/月；企业版 12000 元/年')
    ]);

    expect(draft).toMatchObject({
      workflow: 'quote',
      confidence: 'high',
      subtotal: 3000,
      pricingRuleCount: 2
    });
    expect(draft.matchedRules).toHaveLength(1);
    expect(draft.basis[0]).toContain('网站维护套餐');
    expect(draft.emailDraft).toContain('小计：¥3,000');
    expect(draft.htmlArtifact).toContain('<h1>报价草案</h1>');
    expect(renderQuoteDraft(draft)).toContain('小计：¥3,000');
  });

  it('handles missing pricing rules safely', () => {
    const draft = buildQuoteDraft('给 Acme 出网站维护套餐报价', []);

    expect(draft).toMatchObject({
      confidence: 'low',
      subtotal: null,
      pricingRuleCount: 0
    });
    expect(draft.riskNotes[0]).toContain('没有导入价格表');
  });
});

function pricingMemory(content: string): MemoryRecord {
  return {
    id: 'mem_pricing',
    type: 'pricing',
    content,
    importance: 'high',
    created_by_user_id: 'usr_123',
    metadata: {},
    created_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z',
    archived_at: null
  };
}
