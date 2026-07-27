import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import type { Repositories } from '../db/repositories.js';
import { createModelProviderFromConfig } from '../ai/modelProvider.js';
import { parseSpreadsheet, tablesToText } from '../finance/statementParser.js';
import { runPersonaDistillation } from '../a-self/distill.js';
import type { FeishuClient, FeishuDownloadedResource } from './client.js';
import type { FeishuMessageEvent } from './types.js';

const BLOCKED_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.ps1', '.msi', '.apk', '.app']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.jsonl', '.csv', '.log', '.html', '.htm']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.ods']);
const PERSONA_NAME_HINT = /(聊天|对话|记录|微信|wechat|telegram|feishu|飞书|whatsapp|conversation|chat|message|export|日记|决策|复盘)/i;
const FINANCE_NAME_HINT = /(财务|流水|账单|银行|收支|交易|报销|发票|利润|现金流|finance|statement|transaction|invoice|expense|income)/i;

type IngestResult = {
  taskId: string;
  artifactId: string;
  kind: 'persona_source' | 'finance_sheet' | 'general_file' | 'image';
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
    const kind = classifyAttachmentFile(fileName, buffer, resource.type);
    const existingArtifact = await this.repos.findArtifactBySha256(hash);
    if (existingArtifact) {
      return {
        taskId: existingArtifact.task_id ?? 'existing',
        artifactId: existingArtifact.id,
        kind,
        fileName,
        summary: `检测到相同文件已处理，复用已有资料资产 ${existingArtifact.id}，未重复写入人格或财务数据。`
      };
    }
    const task = await this.repos.createTask({
      title: attachmentTaskTitle(kind, fileName),
      description: `飞书收到附件 ${fileName}，已下载并进入自动处理。`,
      originMessageId: context.originMessageId,
      ownerAgent: kind === 'finance_sheet' ? 'finance' : kind === 'persona_source' ? 'chief_of_staff' : 'knowledge_base',
      status: 'running',
      planningMetadata: {
        source: 'feishu_attachment',
        feishuMessageId: event.message_id,
        feishuChatId: event.chat_id,
        fileName,
        filePath: resource.localPath,
        sizeBytes: resource.sizeBytes,
        sha256: hash,
        attachmentKind: kind
      }
    });
    const artifact = await this.repos.createArtifact({
      taskId: task.id,
      type: `feishu_${kind}`,
      title: fileName,
      uri: resource.localPath,
      metadata: {
        source: 'feishu_attachment',
        feishuMessageId: event.message_id,
        fileKey: resource.key,
        sizeBytes: resource.sizeBytes,
        sha256: hash
      }
    });

    let summary: string;
    try {
      if (kind === 'persona_source') summary = await this.processPersonaSource(buffer, fileName, hash, event.message_id);
      else if (kind === 'finance_sheet') summary = await this.processFinanceSheet(buffer, fileName, task.id, artifact.id);
      else summary = `原件已安全保存为资料资产，文件大小 ${formatBytes(resource.sizeBytes)}。当前格式暂不做内容级自动解析。`;
      await this.repos.completeTask(task.id, summary);
    } catch (error) {
      await this.repos.updateTaskStatus(task.id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
    await this.repos.audit({
      actorType: 'feishu',
      actorId: event.sender_id,
      action: 'feishu_attachment_ingested',
      entityType: 'task',
      entityId: task.id,
      metadata: { artifactId: artifact.id, kind, fileName, sha256: hash, sizeBytes: resource.sizeBytes }
    });
    return { taskId: task.id, artifactId: artifact.id, kind, fileName, summary };
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

export function classifyAttachmentFile(fileName: string, buffer: Buffer, resourceType: 'image' | 'file'): IngestResult['kind'] {
  if (resourceType === 'image') return 'image';
  const ext = path.extname(fileName).toLowerCase();
  const preview = TEXT_EXTENSIONS.has(ext) ? buffer.subarray(0, 24000).toString('utf8') : '';
  const personaSignals = countMatches(`${fileName}\n${preview}`, /(sender|speaker|message|消息|发送者|发言人|聊天记录|nickname|微信|对话|decision|为什么|选择)/gi);
  const financeSignals = countMatches(`${fileName}\n${preview}`, /(金额|收入|支出|余额|交易|借方|贷方|付款|收款|amount|income|expense|balance|transaction|invoice)/gi);
  if (SHEET_EXTENSIONS.has(ext) && (FINANCE_NAME_HINT.test(fileName) || financeSignals > personaSignals)) return 'finance_sheet';
  if ((TEXT_EXTENSIONS.has(ext) || SHEET_EXTENSIONS.has(ext)) && (PERSONA_NAME_HINT.test(fileName) || personaSignals >= financeSignals)) return 'persona_source';
  return 'general_file';
}

function extractText(buffer: Buffer, fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (SHEET_EXTENSIONS.has(ext)) return tablesToText(parseSpreadsheet(buffer, fileName), 60000);
  if (TEXT_EXTENSIONS.has(ext)) return buffer.toString('utf8').replace(/\u0000/g, '').slice(0, 100000);
  return '';
}

function attachmentTaskTitle(kind: IngestResult['kind'], fileName: string) {
  if (kind === 'persona_source') return `蒸馏数字人格资料：${fileName}`;
  if (kind === 'finance_sheet') return `解析财务表格：${fileName}`;
  if (kind === 'image') return `保存飞书图片：${fileName}`;
  return `导入公司资料：${fileName}`;
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

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
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
