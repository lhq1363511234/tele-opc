import { CustomerEmailSender } from '../email/campaignEmailSender.js';
import { FeishuBaseClient } from '../appos/feishu/base-client.js';
import type { AgentTool } from './agentRunner.js';

export interface ExternalActionRepositories {
  searchLeads(params: { query?: string; limit: number; offset: number }): Promise<{
    total: number;
    leads: ReadonlyArray<{ id: string; name: string; email?: string | null; organization_name?: string | null }>;
  }>;
}

export interface ExternalActionOptions {
  taskId?: string;
  wechat?: {
    sendText(input: { accountId: string; peerId: string; text: string; sourceMessageId?: string }): Promise<Record<string, unknown>>;
  };
  feishu?: {
    appId: string;
    appSecret: string;
    appToken: string;
    baseUrl?: string;
  };
}

/**
 * Real outward-facing actions. Every tool here is marked `approvalRequired`,
 * so AgentRunner blocks the call and files an approval instead of executing.
 * The actual send happens only after the owner approves, via runApprovedAction.
 */
export function buildExternalActionTools(
  repos: ExternalActionRepositories,
  options: ExternalActionOptions = {}
): AgentTool[] {
  const tools: AgentTool[] = [
    {
      name: 'send_email',
      description:
        'Send a real email to an external recipient. Requires owner approval before it goes out, so write the final version — do not send drafts or placeholders. Never invent recipient addresses.',
      approvalRequired: true,
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient address. Comma-separate for several.' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Plain text body, final wording.' },
          reason: { type: 'string', description: 'Why this email is being sent, shown to the owner in the approval.' }
        },
        required: ['to', 'subject', 'body'],
        additionalProperties: false
      },
      async execute(input) {
        // Reached only when replayed post-approval by runApprovedAction.
        return await sendEmailAction(input);
      }
    }
  ];

  if (options.feishu?.appId && options.feishu.appSecret && options.feishu.appToken) {
    const feishu = options.feishu;
    tools.push({
      name: 'write_feishu_table',
      description:
        'Append rows to a Feishu Bitable table so the owner can review data in Feishu. Requires owner approval. Unknown field names are dropped automatically, so match the existing columns.',
      approvalRequired: true,
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Logical table name or table id, e.g. OperatingLeads.' },
          rows: {
            type: 'array',
            description: 'Rows as flat objects keyed by column name.',
            items: { type: 'object' }
          },
          reason: { type: 'string', description: 'Why these rows are being written.' }
        },
        required: ['table', 'rows'],
        additionalProperties: false
      },
      async execute(input) {
        return await writeFeishuTableAction(input, feishu);
      }
    });
  }

  void repos;
  return tools;
}

/** Performs the real send. Shared by the tool and the post-approval replay. */
export async function sendEmailAction(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const to = String(input.to ?? '').trim();
  const subject = String(input.subject ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (!to || !subject || !body) return { ok: false, error: 'to_subject_body_required' };

  const sender = CustomerEmailSender.fromEnv();
  const status = sender.getStatus();
  if (!status.transportReady) {
    return { ok: false, error: 'smtp_not_configured', status };
  }

  const result = await sender.sendCustomerEmail({ to, subject, text: body });
  return {
    ok: result.ok,
    status: result.status,
    to: result.to,
    subject: result.subject,
    messageId: result.messageId,
    error: result.error ?? result.reason
  };
}

/** Performs the real Bitable write. Shared by the tool and the replay path. */
export async function writeFeishuTableAction(
  input: Record<string, unknown>,
  credentials: { appId: string; appSecret: string; appToken: string; baseUrl?: string }
): Promise<Record<string, unknown>> {
  const table = String(input.table ?? '').trim();
  const rows = Array.isArray(input.rows)
    ? input.rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    : [];
  if (!table || !rows.length) return { ok: false, error: 'table_and_rows_required' };

  const client = new FeishuBaseClient({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    appToken: credentials.appToken,
    baseUrl: credentials.baseUrl
  });

  try {
    const created = await client.batchCreateRecords(table, rows.slice(0, 100));
    return { ok: true, table, written: created.length };
  } catch (error) {
    return { ok: false, table, error: error instanceof Error ? error.message : 'feishu_write_failed' };
  }
}

/**
 * Replays an approved external action for real. Called by the worker when a
 * task is dequeued with source='approval', which previously only wrote a
 * placeholder string and never executed anything.
 */
export async function runApprovedAction(
  actionType: string,
  payload: Record<string, unknown>,
  options: ExternalActionOptions = {}
): Promise<Record<string, unknown>> {
  const input = (payload.toolInput ?? payload) as Record<string, unknown>;
  switch (actionType) {
    case 'send_email':
      return await sendEmailAction(input);
    case 'wechat_send_message': {
      if (!options.wechat) return { ok: false, error: 'wechat_ilink_not_configured' };
      const accountId = String(input.accountId ?? '').trim();
      const peerId = String(input.peerId ?? '').trim();
      const text = String(input.text ?? '').trim();
      if (!accountId || !peerId || !text) return { ok: false, error: 'wechat_account_peer_text_required' };
      return await options.wechat.sendText({
        accountId, peerId, text,
        sourceMessageId: typeof input.sourceMessageId === 'string' ? input.sourceMessageId : undefined
      });
    }
    case 'write_feishu_table':
      if (!options.feishu?.appId || !options.feishu.appSecret || !options.feishu.appToken) {
        return { ok: false, error: 'feishu_not_configured' };
      }
      return await writeFeishuTableAction(input, options.feishu);
    default:
      return { ok: false, error: 'unsupported_action', actionType };
  }
}
