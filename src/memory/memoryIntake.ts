import type { MemoryType } from '../types.js';

const memoryTypes: MemoryType[] = [
  'strategic',
  'operational',
  'relationship',
  'financial',
  'preference',
  'playbook',
  'pricing'
];

export interface MemoryIntake {
  content: string;
  type: MemoryType;
  reasons: string[];
}

export function parseMemoryInstruction(text: string): MemoryIntake | null {
  const normalizedText = text.trim();
  const match =
    normalizedText.match(/^(?:请)?记住[：:，,\s]+(.+)$/i) ?? normalizedText.match(/^remember[：:,\s]+(.+)$/i);
  const content = match?.[1]?.trim();
  if (!content) return null;

  const classification = classifyMemory(content);
  return {
    content,
    type: classification.type,
    reasons: classification.reasons
  };
}

export function isMemoryType(value: string): value is MemoryType {
  return memoryTypes.includes(value as MemoryType);
}

export function supportedMemoryTypes() {
  return [...memoryTypes];
}

function classifyMemory(content: string): { type: MemoryType; reasons: string[] } {
  if (/流程|步骤|SOP|playbook|标准做法|模板/i.test(content)) {
    return { type: 'playbook', reasons: ['content describes a reusable workflow'] };
  }

  if (/喜欢|偏好|语气|风格|默认|不要|每次|习惯|短一点|简短|最大|最多|不超过|控制在|prefer/i.test(content)) {
    return { type: 'preference', reasons: ['content describes an operator or company preference'] };
  }

  if (/客户|联系人|Alice|Bob|公司|线索|关系|对方|负责人/i.test(content)) {
    return { type: 'relationship', reasons: ['content describes a person, customer, or organization'] };
  }

  if (/现金流|收入|支出|发票|订阅|预算|成本|财务|付款|退款/i.test(content)) {
    return { type: 'financial', reasons: ['content describes finance context'] };
  }

  if (/报价|价格|价格表|服务包|套餐|折扣|quote|pricing/i.test(content)) {
    return { type: 'pricing', reasons: ['content describes pricing or quote rules'] };
  }

  if (/目标|战略|定位|愿景|方向|年度|季度/i.test(content)) {
    return { type: 'strategic', reasons: ['content describes strategic context'] };
  }

  return { type: 'operational', reasons: ['content describes general operating context'] };
}
