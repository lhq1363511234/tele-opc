import { describe, expect, it } from 'vitest';
import { getSkillDefinition, listSkills, selectSkillsForText } from '../src/skills/registry.js';

describe('Skill Registry', () => {
  it('exposes industry and function skills for V3 routing', () => {
    expect(listSkills('industry').map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        'industry.restaurant_local_life',
        'industry.cross_border_ecommerce',
        'industry.saas_software_service',
        'industry.content_ip_media'
      ])
    );
    expect(listSkills('function').map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        'function.market_research',
        'function.prospecting',
        'function.crm_followup',
        'function.finance_modeling',
        'function.pricing_quote'
      ])
    );
  });

  it('selects industry, function, and execution skills from natural language', () => {
    const selection = selectSkillsForText('帮我做深圳健康轻食外卖市场调研，并做客户挖掘和浏览器公开资料研究', [
      'function.prospecting'
    ]);

    expect(selection.industrySkills.map((skill) => skill.id)).toContain('industry.restaurant_local_life');
    expect(selection.functionSkills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining(['function.market_research', 'function.prospecting'])
    );
    expect(selection.executionSkills.map((skill) => skill.id)).toContain('execution.browser_research');
    expect(selection.industrySkills.length + selection.functionSkills.length + selection.executionSkills.length).toBeGreaterThan(3);
  });

  it('returns skill details by id', () => {
    expect(getSkillDefinition('industry.restaurant_local_life')).toMatchObject({
      id: 'industry.restaurant_local_life',
      type: 'industry',
      status: 'built_in'
    });
  });
});
