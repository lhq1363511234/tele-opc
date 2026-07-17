export interface CrmLeadIntake {
  name: string;
  organizationName?: string;
  interest?: string;
  note: string;
  sourceText: string;
}

export function parseCrmLeadInstruction(text: string): CrmLeadIntake | null {
  const normalizedText = text.trim();
  if (!/(线索|联系人|客户)/i.test(normalizedText)) return null;
  if (!/(加为|加入|新增|创建|记录|保存)/i.test(normalizedText)) return null;

  const name = extractName(normalizedText);
  if (!name) return null;

  const organizationName = extractOrganization(normalizedText);
  const interest = extractInterest(normalizedText);

  return {
    name,
    organizationName,
    interest,
    note: buildNote({ organizationName, interest, sourceText: normalizedText }),
    sourceText: normalizedText
  };
}

function extractName(text: string) {
  const patterns = [
    /把\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*(?:加为|加入|新增|创建|记录|保存)/,
    /(?:新增|创建|记录|保存)\s*(?:线索|联系人|客户)\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)/,
    /(?:线索|联系人|客户)[：:\s]+([A-Za-z0-9_\-\u4e00-\u9fa5]+)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanup(match[1]);
  }

  return undefined;
}

function extractOrganization(text: string) {
  const match = text.match(/(?:来自|公司是|所属公司|在|from)\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)(?:[，,。；;]|$)/i);
  return match?.[1] ? cleanup(match[1]) : undefined;
}

function extractInterest(text: string) {
  const match = text.match(/对\s*([^，,。；;]+?)\s*(?:感兴趣|有兴趣|关注)/);
  return match?.[1] ? cleanup(match[1]) : undefined;
}

function buildNote(params: { organizationName?: string; interest?: string; sourceText: string }) {
  const parts = [];
  if (params.organizationName) parts.push(`来自 ${params.organizationName}`);
  if (params.interest) parts.push(`对 ${params.interest} 感兴趣`);
  return parts.length ? parts.join('；') : params.sourceText;
}

function cleanup(value: string) {
  return value.trim().replace(/[，,。；;]+$/g, '');
}
