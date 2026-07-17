import { describe, expect, it } from 'vitest';
import { parseMemoryInstruction } from '../src/memory/memoryIntake.js';

describe('parseMemoryInstruction', () => {
  it('accepts Chinese comma memory instructions', () => {
    const result = parseMemoryInstruction('记住，客户跟进邮件要短一点，最大 120 字。');

    expect(result).toMatchObject({
      type: 'preference',
      content: '客户跟进邮件要短一点，最大 120 字。'
    });
  });

  it('classifies reusable workflows as playbooks', () => {
    const result = parseMemoryInstruction('记住：新客户 onboarding 的标准流程是先确认目标，再安排启动会。');

    expect(result).toMatchObject({
      type: 'playbook'
    });
  });
});
