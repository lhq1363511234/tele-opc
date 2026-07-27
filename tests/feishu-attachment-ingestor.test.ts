import { describe, expect, it } from 'vitest';
import { normalizeAttachmentDisposition } from '../src/feishu/attachmentIngestor.js';

describe('digital-self attachment disposition', () => {
  it('supports multiple destinations and operations chosen by the persona', () => {
    const decision = normalizeAttachmentDisposition({
      title: '吸收创始人访谈并建立销售任务',
      understanding: '这既包含本人决策证据，也包含潜在客户需求。',
      reasoning: '同一资料应多路使用，不能按扩展名放进单一入口。',
      confidence: 0.88,
      ownerAgent: 'chief_of_staff',
      destinations: ['数字人格证据库', '客户需求知识库'],
      operations: ['extract_persona_evidence', 'store_company_knowledge', 'create_project_task'],
      followupTask: '从访谈中提炼三个可销售服务'
    }, '任意文件.bin');

    expect(decision.destinations).toEqual(['数字人格证据库', '客户需求知识库']);
    expect(decision.operations).toEqual([
      'archive_source',
      'extract_persona_evidence',
      'store_company_knowledge',
      'create_project_task'
    ]);
  });

  it('removes unknown operations but always preserves the source', () => {
    const decision = normalizeAttachmentDisposition({ operations: ['delete_everything', 'analyze_finance'] }, '资料.dat');
    expect(decision.operations).toEqual(['archive_source', 'analyze_finance']);
  });

  it('does not infer business purpose from filename in deterministic code', () => {
    const decision = normalizeAttachmentDisposition({}, '银行流水.csv');
    expect(decision.operations).toEqual(['archive_source']);
    expect(decision.destinations).toEqual(['资料暂存区']);
  });
});
