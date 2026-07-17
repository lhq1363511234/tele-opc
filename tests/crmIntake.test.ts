import { describe, expect, it } from 'vitest';
import { parseCrmLeadInstruction } from '../src/crm/crmIntake.js';

describe('parseCrmLeadInstruction', () => {
  it('extracts lead, organization, and interest from Chinese lead instructions', () => {
    const result = parseCrmLeadInstruction('把 Jane 加为新线索，她来自 Acme，对企业版感兴趣。');

    expect(result).toMatchObject({
      name: 'Jane',
      organizationName: 'Acme',
      interest: '企业版'
    });
  });

  it('ignores non-CRM task text', () => {
    expect(parseCrmLeadInstruction('帮我分析这个月的任务完成情况')).toBeNull();
  });
});
