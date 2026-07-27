import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { parseSpreadsheet, tablesToText } from '../finance/statementParser.js';
import { runPersonaDistillation } from '../a-self/distill.js';
import { buildContextPack, contextPackForAgentRuntime } from '../brain/contextPack.js';
import type { FeishuClient, FeishuDownloadedResource } from './client.js';
import type { FeishuMessageEvent } from './types.js';

const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.ps1', '.msi', '.apk', '.app']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.jsonl', '.csv', '.log', '.html', '.htm']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.ods']);
export type AttachmentOperation =
  | 'archive_source'
  | 'extract_persona_evidence'
  | 'analyze_finance'
  | 'store_company_knowledge'
  | 'create_project_task'
  | 'ask_owner';

export type AttachmentDisposition = {
  title: string;
  understanding: string;
  reasoning: string;
  confidence: number;
  ownerAgent: string;
  destinations: string[];
  operations: AttachmentOperation[];
  needsOwnerInput: boolean;
  ownerQuestion: string;
  followupTask: string;
};

type IngestResult = {
  taskId: string;
  artifactId: string;
  disposition: AttachmentDisposition;
  fileName: string;
  summary: string;
};

export class FeishuAttachmentIngestor {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repositories,
    private readonly client: FeishuClient
  ) {}

  async ingest(event: FeishuMessageEvent, context: { userId: string; chatId: string; originMessageId: string }) {
    const inbox = path.resolve(process.cwd(), 'runtime', 'feishu-inbox', safeSegment(event.message_id));
    const downloaded = await this.client.downloadMessageResources(event.message_id, inbox);
    if (!downloaded.resources.length) {
      throw new Error('没有从飞书消息中找到可下载的文件资源。请确认应用已开启 im:message:readonly 权限。');
    }
    if (downloaded.resources.length > 8) throw new Error('单条消息最多自动处理 8 个附件，请分批上传。');
    const totalBytes = downloaded.resources.reduce((sum, resource) => sum + resource.sizeBytes, 0);
    if (totalBytes > this.config.feishu.attachmentMaxBytes) {
      throw new Error(`附件总大小超过自动处理上限 ${formatBytes(this.config.feishu.attachmentMaxBytes)}，请分批上传。`);
    }

    const results: IngestResult[] = [];
    for (const resource of downloaded.resources) {
      results.push(await this.ingestOne(resource, event, context));
    }
    return results;
  }

  private async ingestOne(resource: FeishuDownloadedResource, event: FeishuMessageEvent, context: { userId: string; chatId: string; originMessageId: string }): Promise<IngestResult> {
    const fileName = safeFileName(resource.originalName || path.basename(resource.localPath));
    const extension = path.extname(fileName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) throw new Error(`出于安全原因不自动处理可执行文件：${fileName}`);
    const hash = await sha256File(resource.localPath);
    const buffer = await fs.readFile(resource.localPath);
    const existingArtifact = await this.repos.findArtifactBySha256(hash);
    if (existingArtifact) {
      return {
        taskId: existingArtifact.task_id ?? 'existing',
        artifactId: existingArtifact.id,
        disposition: fallbackDisposition(fileName, '检测到相同文件，沿用已有处理结果。'),
        fileName,
        summary: `检测到相同文件已处理，复用已有资料资产 ${existingArtifact.id}，没有重复写入任何业务数据。`
      };
    }

    const disposition = await this.decideDisposition(buffer, fileName, resource.type, context.chatId);
    const task = await this.repos.createTask({
      title: disposition.title || `理解并处理资料：${fileName}`,
      description: [
        `飞书收到附件 ${fileName}。`,
        `数字本人理解：${disposition.understanding}`,
        `判断依据：${disposition.reasoning}`,
        `计划操作：${disposition.operations.join(', ')}`
      ].join('\n'),
      originMessageId: context.originMessageId,
      ownerAgent: normalizeOwnerAgent(disposition.ownerAgent),
      status: 'running',
      planningMetadata: {
        source: 'feishu_attachment',
        feishuMessageId: event.message_id,
        feishuChatId: event.chat_id,
        fileName,
        filePath: resource.localPath,
        sizeBytes: resource.sizeBytes,
        sha256: hash,
        disposition
      }
    });
    const artifact = await this.repos.createArtifact({
      taskId: task.id,
      type: 'feishu_source_material',
      title: fileName,
      uri: resource.localPath,
      metadata: {
        source: 'feishu_attachment',
        feishuMessageId: event.message_id,
        fileKey: resource.key,
        sizeBytes: resource.sizeBytes,
        sha256: hash,
        disposition
      }
    });
    await this.repos.createArtifact({
      taskId: task.id,
      type: 'attachment_disposition',
      title: `${fileName} · 数字本人处置判断`,
      uri: `tele-opc://artifacts/${artifact.id}/disposition`,
      content: JSON.stringify(disposition, null, 2),
      metadata: { sourceArtifactId: artifact.id, decidedBy: 'digital_self' }
    });

    const operationResults: string[] = [];
    try {
      for (const operation of disposition.operations) {
        try {
          if (operation === 'extract_persona_evidence') {
            operationResults.push(await this.processPersonaSource(buffer, fileName, hash, event.message_id));
          } else if (operation === 'analyze_finance') {
            operationResults.push(await this.processFinanceSheet(buffer, fileName, task.id, artifact.id));
          } else if (operation === 'store_company_knowledge') {
            operationResults.push(`已按数字本人的判断归入：${disposition.destinations.join('、') || '公司资料库'}。`);
          } else if (operation === 'create_project_task' && disposition.followupTask) {
            const followup = await this.repos.createTask({
              title: disposition.followupTask.slice(0, 180),
              description: `由资料 ${fileName} 触发。\n${disposition.reasoning}`,
              parentTaskId: task.id,
              ownerAgent: normalizeOwnerAgent(disposition.ownerAgent),
              status: 'planned',
              planningMetadata: { source: 'digital_self_attachment_decision', sourceArtifactId: artifact.id }
            });
            operationResults.push(`已根据资料建立后续任务 ${followup.id}：${followup.title}`);
          } else if (operation === 'ask_owner') {
            operationResults.push(`数字本人需要你补充：${disposition.ownerQuestion || '请说明这份资料希望达成的结果。'}`);
          }
        } catch (error) {
          operationResults.push(`操作 ${operation} 未完成：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!operationResults.length) operationResults.push('原件已安全归档，数字本人暂未决定进行内容级写入。');
      const summary = [
        `数字本人判断：${disposition.understanding}`,
        `放置位置：${disposition.destinations.join('、') || '资料暂存区'}`,
        ...operationResults
      ].join('\n');
      await this.repos.completeTask(task.id, summary);
      await this.repos.audit({
        actorType: 'feishu',
        actorId: event.sender_id,
        action: 'feishu_attachment_ingested',
        entityType: 'task',
        entityId: task.id,
        metadata: { artifactId: artifact.id, disposition, fileName, sha256: hash, sizeBytes: resource.sizeBytes }
      });
      return { taskId: task.id, artifactId: artifact.id, disposition, fileName, summary };
    } catch (error) {
      await this.repos.updateTaskStatus(task.id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async decideDisposition(buffer: Buffer, fileName: string, resourceType: 'image' | 'file', chatId: string): Promise<AttachmentDisposition> {
    const provider = createModelProviderFromConfig(this.config);
    if (!provider) return fallbackDisposition(fileName, '当前模型不可用，先安全归档，等待数字本人恢复后再判断。');
    const preview = contentPreview(buffer, fileName, resourceType);
    const contextPack = await buildContextPack(this.repos, {
      querySummary: `判断新上传资料 ${fileName} 应该放到哪里、如何使用`,
      chatId
    });
    const runtimeContext = contextPackForAgentRuntime(contextPack);
    const response = await provider.chat({
      messages: [
        {
          role: 'system',
          content: [
            '你就是当前用户本人的数字人格，不是文件分类器，也不是给用户列菜单的助手。',
            '结合本人的人格、最近对话、公司状态和资料内容，替本人决定这份资料的意义、应放到哪里、现在应执行哪些可逆操作。',
            '同一资料可以多路使用。不要根据文件名关键词机械分类。只有确实无法可靠判断或需要身份信息时才 ask_owner。',
            '安全下载、格式解析和不可逆审批由系统负责；你负责业务判断、优先级和处置计划。严格输出 JSON。'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            '【当前数字本人和公司上下文】',
            JSON.stringify(runtimeContext).slice(0, 30000),
            '',
            '【新资料】',
            `文件名：${fileName}`,
            `资源类型：${resourceType}`,
            `大小：${formatBytes(buffer.length)}`,
            `可读取内容预览：\n${preview || '当前格式没有可读取文本，只能结合文件元数据和最近对话判断。'}`,
            '',
            '可执行操作（可以多选）：archive_source、extract_persona_evidence、analyze_finance、store_company_knowledge、create_project_task、ask_owner。',
            'destinations 是你根据公司和本人实际情况自由命名的业务位置，不是固定枚举。',
            '输出：{"title":"处理任务标题","understanding":"你认为这是什么以及价值","reasoning":"为什么这样处置","confidence":0.0,"ownerAgent":"chief_of_staff|finance|crm|knowledge_base|browser","destinations":["自由命名位置"],"operations":["archive_source"],"needsOwnerInput":false,"ownerQuestion":"","followupTask":""}'
          ].join('\n')
        }
      ],
      temperature: 0.1
    });
    return normalizeAttachmentDisposition(parseJsonObject(response.content), fileName);
  }

  private async processPersonaSource(buffer: Buffer, fileName: string, hash: string, messageId: string) {
    const sourceText = extractText(buffer, fileName);
    if (!sourceText.trim()) return '文件已保存，但没有提取到可用于人格蒸馏的文本。';
    const provider = createModelProviderFromConfig(this.config);
    let memories: Array<{ category?: string; title?: string; content?: string; why?: string; confidence?: number; tags?: string[] }> = [];
    let decisions: Array<{ question?: string; choice?: string; why?: string; futureRule?: string; impact?: string }> = [];

    if (provider) {
      const response = await provider.chat({
        messages: [
          {
            role: 'system',
            content: '你是数字人格证据蒸馏器。只提取资料中有证据支持的本人经历、偏好、价值排序、沟通模式和决策。区分本人发言与他人发言；不确定谁是本人时降低 confidence，不得把他人的观点冒充本人。严格输出 JSON。'
          },
          {
            role: 'user',
            content: [
              `资料文件：${fileName}`,
              '输出结构：{"memories":[{"category":"experience|value|preference|relationship|business|communication","title":"","content":"","why":"证据和形成原因","confidence":0.0,"tags":[]}],"decisions":[{"question":"","choice":"","why":"","futureRule":"","impact":"low|medium|high"}]}',
              '最多提取 20 条高价值记忆和 12 条决策，忽略寒暄、验证码、无意义转发和纯他人观点。',
              '',
              sourceText.slice(0, 60000)
            ].join('\n')
          }
        ],
        temperature: 0.1
      });
      const parsed = parseJsonObject(response.content);
      memories = Array.isArray(parsed.memories) ? parsed.memories.filter(isRecord) as typeof memories : [];
      decisions = Array.isArray(parsed.decisions) ? parsed.decisions.filter(isRecord) as typeof decisions : [];
    }

    if (!memories.length) {
      memories = chunkText(sourceText, 7000, 8).map((content, index) => ({
        category: 'conversation_evidence',
        title: `${fileName} · 原始证据 ${index + 1}`,
        content,
        why: '来自用户主动上传的资料，尚未完成结构化证据提取。',
        confidence: 0.45,
        tags: ['飞书上传', '待进一步蒸馏']
      }));
    }

    let memoryCount = 0;
    for (const [index, memory] of memories.slice(0, 20).entries()) {
      const content = stringValue(memory.content).trim();
      if (!content) continue;
      await this.repos.createASelfMemoryItem({
        category: stringValue(memory.category) || 'conversation_evidence',
        title: stringValue(memory.title) || `${fileName} · 人格证据 ${index + 1}`,
        content: content.slice(0, 12000),
        why: stringValue(memory.why) || '从用户上传资料中提取。',
        tags: Array.isArray(memory.tags) ? memory.tags.map(String).slice(0, 12) : ['飞书上传'],
        source: 'feishu_attachment',
        sensitivity: 'private',
        confidence: clampConfidence(memory.confidence),
        metadata: { fileName, sha256: hash, feishuMessageId: messageId }
      });
      memoryCount += 1;
    }

    let decisionCount = 0;
    for (const decision of decisions.slice(0, 12)) {
      const question = stringValue(decision.question).trim();
      const choice = stringValue(decision.choice).trim();
      const why = stringValue(decision.why).trim();
      if (!question || !choice || !why) continue;
      await this.repos.createASelfDecisionLog({
        question,
        choice,
        why,
        futureRule: stringValue(decision.futureRule) || null,
        impact: ['low', 'medium', 'high'].includes(stringValue(decision.impact)) ? stringValue(decision.impact) : 'unknown',
        metadata: { source: 'feishu_attachment', fileName, sha256: hash, feishuMessageId: messageId }
      });
      decisionCount += 1;
    }

    let distilled = false;
    if (provider && memoryCount > 0) {
      await runPersonaDistillation(this.repos, this.config);
      distilled = true;
    }
    return `已提取 ${memoryCount} 条人格记忆、${decisionCount} 条决策记录${distilled ? '，并重新蒸馏数字人格' : ''}。所有资料按 private 保存。`;
  }

  private async processFinanceSheet(buffer: Buffer, fileName: string, taskId: string, artifactId: string) {
    const tables = parseSpreadsheet(buffer, fileName);
    if (!tables.length) return '表格原件已保存，但没有发现可读取的工作表。';
    const tableText = tablesToText(tables, 50000);
    const provider = createModelProviderFromConfig(this.config);
    let analysis: Record<string, unknown> = {
      summary: '已完成工作表结构识别，等待模型进行财务语义分析。',
      entries: [],
      risks: []
    };
    if (provider) {
      const response = await provider.chat({
        messages: [
          { role: 'system', content: '你是严谨的企业财务表格分析器。金额必须来自原表，不得估算或编造。严格输出 JSON。' },
          {
            role: 'user',
            content: [
              `文件：${fileName}`,
              '识别收入、支出、日期、交易方、分类、异常和需要人工确认的行。跳过合计、余额和标题行。',
              '输出：{"summary":"","currency":"CNY","entries":[{"direction":"income|expense","amount":0,"counterparty":"","category":"","description":"","occurredAt":"YYYY-MM-DD","confidence":0.0}],"risks":[""],"insights":[""]}',
              '最多输出 300 条 entries。',
              '',
              tableText
            ].join('\n')
          }
        ],
        temperature: 0.1
      });
      analysis = parseJsonObject(response.content);
    }
    const entries = Array.isArray(analysis.entries) ? analysis.entries.filter(isRecord).slice(0, 300) : [];
    const income = entries.filter((entry) => entry.direction === 'income').reduce((sum, entry) => sum + positiveNumber(entry.amount), 0);
    const expense = entries.filter((entry) => entry.direction === 'expense').reduce((sum, entry) => sum + positiveNumber(entry.amount), 0);
    const analysisArtifact = await this.repos.createArtifact({
      taskId,
      type: 'finance_spreadsheet_analysis',
      title: `${fileName} · 财务解析结果`,
      uri: `tele-opc://artifacts/${artifactId}/finance-analysis`,
      content: JSON.stringify({ ...analysis, computedSummary: { entries: entries.length, income, expense, net: income - expense } }, null, 2),
      metadata: { sourceArtifactId: artifactId, sheetCount: tables.length, entryCount: entries.length, staged: true }
    });
    return `已读取 ${tables.length} 个工作表，识别 ${entries.length} 条财务明细；收入 ${income.toFixed(2)}，支出 ${expense.toFixed(2)}，净额 ${(income - expense).toFixed(2)}。解析结果已保存为 ${analysisArtifact.id}，当前先暂存分析，不会重复污染正式账本。`;
  }
}

function extractText(buffer: Buffer, fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (SHEET_EXTENSIONS.has(ext)) return tablesToText(parseSpreadsheet(buffer, fileName), 60000);
  if (TEXT_EXTENSIONS.has(ext)) return buffer.toString('utf8').replace(/\u0000/g, '').slice(0, 100000);
  return '';
}

function contentPreview(buffer: Buffer, fileName: string, resourceType: 'image' | 'file') {
  if (resourceType === 'image') return '';
  try {
    return extractText(buffer, fileName).slice(0, 50000);
  } catch {
    return '';
  }
}

export function normalizeAttachmentDisposition(value: Record<string, unknown>, fileName: string): AttachmentDisposition {
  const allowed = new Set<AttachmentOperation>([
    'archive_source',
    'extract_persona_evidence',
    'analyze_finance',
    'store_company_knowledge',
    'create_project_task',
    'ask_owner'
  ]);
  const operations = Array.isArray(value.operations)
    ? value.operations.map(String).filter((item): item is AttachmentOperation => allowed.has(item as AttachmentOperation))
    : [];
  if (!operations.includes('archive_source')) operations.unshift('archive_source');
  return {
    title: stringValue(value.title) || `理解并处理资料：${fileName}`,
    understanding: stringValue(value.understanding) || '这是用户主动交给数字本人的新资料，需要结合上下文保存并使用。',
    reasoning: stringValue(value.reasoning) || '先保留原始证据，再执行可逆处理。',
    confidence: clampConfidence(value.confidence),
    ownerAgent: normalizeOwnerAgent(stringValue(value.ownerAgent)),
    destinations: Array.isArray(value.destinations) ? value.destinations.map(String).filter(Boolean).slice(0, 8) : ['资料暂存区'],
    operations: [...new Set(operations)],
    needsOwnerInput: value.needsOwnerInput === true || operations.includes('ask_owner'),
    ownerQuestion: stringValue(value.ownerQuestion),
    followupTask: stringValue(value.followupTask)
  };
}

function fallbackDisposition(fileName: string, reason: string): AttachmentDisposition {
  return normalizeAttachmentDisposition({
    title: `暂存并理解资料：${fileName}`,
    understanding: '资料内容尚未由数字本人完成可靠判断。',
    reasoning: reason,
    confidence: 0.2,
    ownerAgent: 'chief_of_staff',
    destinations: ['数字本人资料暂存区'],
    operations: ['archive_source', 'ask_owner'],
    needsOwnerInput: true,
    ownerQuestion: '请告诉我这份资料最希望达成什么结果；我会结合内容自行决定后续放置和处理。'
  }, fileName);
}

function normalizeOwnerAgent(value: string) {
  return ['chief_of_staff', 'finance', 'crm', 'knowledge_base', 'browser'].includes(value) ? value : 'chief_of_staff';
}

function parseJsonObject(value: string): Record<string, unknown> {
  const cleaned = value.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回有效 JSON');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!isRecord(parsed)) throw new Error('模型返回不是 JSON 对象');
  return parsed;
}

function chunkText(value: string, size: number, limit: number) {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length && chunks.length < limit; offset += size) chunks.push(value.slice(offset, offset + size));
  return chunks;
}

async function sha256File(filePath: string) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160) || 'message';
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'feishu-file.bin';
}

function clampConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.1, Math.min(1, number)) : 0.6;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}
