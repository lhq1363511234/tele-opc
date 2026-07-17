import { describe, expect, it } from 'vitest';
import {
  deckInputFromPublicBrief,
  sanitizeSlideDeckSpec,
  slideDeckSpecFromAgentContent,
  slideDeckContainsInternalLeak
} from '../src/deliverables/slideDeckSpec.js';
import { createTaskContract, planContentWorkStrategy } from '../src/work/workStrategy.js';

describe('slide deck artifact firewall', () => {
  it('replaces leaked internal prompt text before rendering a deck', () => {
    const input = deckInputFromPublicBrief({
      originalRequest: '写一个面向客户的 AI Agent OS 产品介绍 PPT',
      title: 'AI Agent OS 产品介绍',
      subject: 'AI Agent OS 产品介绍',
      audience: '客户',
      pageCount: 8,
      style: '简洁商务',
      purpose: '让客户理解产品价值和落地方式。',
      mustInclude: ['产品定位', '能力模块', '落地路径'],
      outputLanguage: '中文',
      deliverableKind: 'presentation_deck'
    });

    const deck = sanitizeSlideDeckSpec({
      title: 'AI Agent OS 产品介绍',
      theme: 'business-clear',
      slides: [
        {
          eyebrow: '04 Problem',
          title: '当前问题',
          subtitle: '把痛点讲具体，方案才有说服力。',
          bullets: [
            'AI Agent OS 当前最需要解决的障碍是什么。',
            '客户 为什么会在这个问题上犹豫或流失。',
            '现有方案哪里不够好，必须用具体场景表达。'
          ]
        }
      ]
    }, input);

    const text = JSON.stringify(deck);
    expect(text).not.toContain('当前最需要解决的障碍是什么');
    expect(text).not.toContain('为什么会在这个问题上犹豫');
    expect(text).not.toContain('哪里不够好');
    expect(text).toContain('AI Agent OS 产品介绍');
    expect(slideDeckContainsInternalLeak(deck)).toBe(false);
  });

  it('keeps PPT mini app form instructions out of the public brief subject', () => {
    const text = [
      '请生成一份可预览的 PPT。',
      '主题：特仑苏有机纯牛奶宣传',
      '受众：销售客户',
      '页数：10页',
      '风格：高端自然',
      '资料和要求：突出有机奶源、家庭早餐、渠道打法'
    ].join('\n');

    const contract = createTaskContract(text, planContentWorkStrategy(text));
    expect(contract.publicBrief.subject).toBe('特仑苏有机纯牛奶宣传');
    expect(contract.publicBrief.title).toBe('特仑苏有机纯牛奶宣传');
    expect(contract.publicBrief.audience).toBe('销售客户');
    expect(contract.publicBrief.pageCount).toBe(10);
    expect(contract.publicBrief.style).toBe('高端自然');
    expect(contract.deliverableAgent).toMatchObject({
      agentId: 'content',
      output: 'slide_deck_spec_json'
    });
    expect(contract.deliverableAgent?.prompt).toContain('主题：特仑苏有机纯牛奶宣传');
    expect(contract.deliverableAgent?.prompt).toContain('你必须输出严格 JSON');
    expect(contract.deliverableAgent?.prompt).toContain('禁止使用这些模板标题');
    expect(JSON.stringify(contract.publicBrief)).not.toContain('AI Agent 团队');
    expect(JSON.stringify(contract.publicBrief)).not.toContain('拆解执行');
    expect(JSON.stringify(contract.publicBrief)).not.toContain('资料和要求');
  });

  it('uses AI-generated slide content instead of the built-in PPT template', async () => {
    const input = deckInputFromPublicBrief({
      originalRequest: '帮我做一个特仑苏有机纯牛奶宣传 PPT',
      title: '特仑苏有机纯牛奶宣传',
      subject: '特仑苏有机纯牛奶宣传',
      audience: '销售客户',
      pageCount: 6,
      style: '高端自然',
      purpose: '用于介绍产品卖点、品牌定位和宣传打法。',
      mustInclude: ['产品定位', '目标人群', '传播主张', '渠道打法'],
      outputLanguage: '中文',
      deliverableKind: 'presentation_deck'
    });
    const agentContent = JSON.stringify({
      title: '特仑苏有机纯牛奶销售提案',
      theme: '高端自然乳品沟通',
      slides: [
        { eyebrow: '01 开场', title: '把特仑苏从一盒奶讲成高品质日常选择', subtitle: '先建立销售客户能转述的购买理由。', bullets: ['有机奶源降低解释成本', '高端包装适合礼赠和家庭早餐', '渠道话术围绕安心营养展开'] },
        { eyebrow: '02 场景', title: '早餐和礼赠是最容易成交的两个入口', subtitle: '把卖点放到客户真实购买场景里。', bullets: ['早餐场景强调稳定营养', '礼赠场景强调体面健康', '办公场景强调方便补给'] },
        { eyebrow: '03 人群', title: '品质家庭愿意为确定感付费', subtitle: '用家庭营养和品牌信任解释溢价。', bullets: ['父母关心配料和来源', '白领重视便利和口感', '礼赠用户需要品牌识别度'] },
        { eyebrow: '04 卖点', title: '有机奶源要转化成看得懂的证据', subtitle: '渠道客户需要能放进货架和详情页的表达。', bullets: ['突出有机认证和牧场故事', '展示检测和品质标准', '减少空泛健康口号'] },
        { eyebrow: '05 渠道', title: '商超讲陈列，电商讲转化，私域讲复购', subtitle: '不同渠道使用不同内容颗粒度。', bullets: ['商超端架强化高端感', '电商详情页突出组合装', '私域围绕早餐计划复购'] },
        { eyebrow: '06 行动', title: '先用小范围物料测试主张，再放大投放', subtitle: '用数据决定下一轮内容和陈列重点。', bullets: ['准备产品图和渠道话术', '测试早餐和礼赠两组素材', '复盘点击加购和复购反馈'] }
      ]
    });

    const deck = slideDeckSpecFromAgentContent(agentContent, input);
    const text = JSON.stringify(deck);

    expect(deck.slides).toHaveLength(6);
    expect(text).toContain('把特仑苏从一盒奶讲成高品质日常选择');
    expect(text).not.toContain('核心传播结论');
    expect(text).not.toContain('消费趋势');
    expect(text).not.toContain('执行节奏');
  });

  it('rejects model output that repeats the old built-in PPT template', async () => {
    const input = deckInputFromPublicBrief({
      originalRequest: '帮我做一个特仑苏有机纯牛奶宣传 PPT',
      title: '特仑苏有机纯牛奶宣传',
      subject: '特仑苏有机纯牛奶宣传',
      audience: '销售客户',
      pageCount: 6,
      style: '高端自然',
      purpose: '用于介绍产品卖点、品牌定位和宣传打法。',
      mustInclude: ['产品定位', '目标人群', '传播主张', '渠道打法'],
      outputLanguage: '中文',
      deliverableKind: 'presentation_deck'
    });
    const agentContent = JSON.stringify({
      title: '特仑苏有机纯牛奶宣传方案',
      theme: 'premium-natural',
      slides: [
        { eyebrow: 'Cover', title: '特仑苏有机纯牛奶宣传方案', subtitle: '高端自然', bullets: ['特仑苏有机纯牛奶宣传', '销售客户', '高端自然'] },
        { eyebrow: '01 Summary', title: '核心传播结论', subtitle: '模板页', bullets: ['特仑苏有机纯牛奶宣传需要建立价值主张', '高端自然', '销售客户'] },
        { eyebrow: '02 Market', title: '消费趋势', subtitle: '模板页', bullets: ['健康升级', '品质升级', '家庭营养'] },
        { eyebrow: '03 Positioning', title: '产品定位', subtitle: '模板页', bullets: ['高端有机奶', '品质生活', '日常营养'] },
        { eyebrow: '04 Audience', title: '目标人群', subtitle: '模板页', bullets: ['品质家庭', '白领', '礼赠用户'] },
        { eyebrow: '05 Message', title: '传播主张', subtitle: '模板页', bullets: ['有机', '安心', '品质'] }
      ]
    });

    expect(() => slideDeckSpecFromAgentContent(agentContent, input)).toThrow('slide_deck_ai_used_builtin_template');
  });
});
