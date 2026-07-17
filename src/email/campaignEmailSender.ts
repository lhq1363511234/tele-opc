import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { CampaignEventRecord, CampaignRecord, LeadRecord } from '../types.js';

export interface CampaignEmailRepositories {
  getCampaign(id: string): Promise<CampaignRecord | null>;
  listLeadsForProspectingRun(prospectingRunId: string, limit?: number): Promise<LeadRecord[]>;
  createCampaignEvent(params: {
    campaignId?: string | null;
    leadId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  }): Promise<CampaignEventRecord>;
  audit(params: {
    actorType: string;
    actorId?: string;
    action: string;
    entityType?: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{
    messageId?: string;
    response?: string;
    accepted?: unknown;
    rejected?: unknown;
  }>;
}

export interface CampaignSendResult {
  ok: boolean;
  campaignId: string;
  status: 'sent' | 'partial' | 'skipped' | 'failed';
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  eventIds: string[];
  reason?: string;
}

export class NodemailerMailTransport implements MailTransport {
  private readonly transport: ReturnType<typeof nodemailer.createTransport<SMTPTransport.SentMessageInfo>>;

  constructor(private readonly from: string) {
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    this.transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: /^true$/i.test(process.env.SMTP_SECURE ?? ''),
      auth: smtpUser && smtpPassword
        ? {
            user: smtpUser,
            pass: smtpPassword
          }
        : undefined
    });
  }

  static fromEnv() {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    if (!process.env.SMTP_HOST || !from) return null;
    if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) return null;
    return new NodemailerMailTransport(from);
  }

  async sendMail(message: { from: string; to: string; subject: string; text: string }) {
    return this.transport.sendMail(message);
  }

  get defaultFrom() {
    return this.from;
  }
}

export class CampaignEmailSender {
  constructor(
    private readonly repos: CampaignEmailRepositories,
    private readonly transport: MailTransport | null = NodemailerMailTransport.fromEnv(),
    private readonly from = process.env.SMTP_FROM || process.env.SMTP_USER || ''
  ) {}

  async sendCampaign(campaignId: string, options: { limit?: number } = {}): Promise<CampaignSendResult> {
    const campaign = await this.repos.getCampaign(campaignId);
    if (!campaign) {
      return emptyResult(campaignId, 'failed', 'campaign_not_found');
    }
    if (!campaign.prospecting_run_id) {
      return emptyResult(campaignId, 'failed', 'campaign_has_no_prospecting_run');
    }

    const leads = await this.repos.listLeadsForProspectingRun(campaign.prospecting_run_id, options.limit ?? 200);
    const eventIds: string[] = [];
    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const lead of leads) {
      const recipient = emailForLead(lead);
      if (!recipient) {
        const event = await this.recordEvent(campaign, lead, 'email_send_skipped', {
          reason: 'missing_recipient_email'
        });
        eventIds.push(event.id);
        skippedCount += 1;
        continue;
      }

      if (!this.transport || !this.from) {
        const event = await this.recordEvent(campaign, lead, 'email_send_skipped', {
          recipient,
          reason: 'smtp_not_configured'
        });
        eventIds.push(event.id);
        skippedCount += 1;
        continue;
      }

      const message = buildMessage(campaign, lead, recipient, this.from);
      try {
        const sent = await this.transport.sendMail(message);
        const event = await this.recordEvent(campaign, lead, 'email_sent', {
          recipient,
          subject: message.subject,
          messageId: sent.messageId,
          response: sent.response,
          accepted: sent.accepted,
          rejected: sent.rejected
        });
        eventIds.push(event.id);
        sentCount += 1;
      } catch (error) {
        const event = await this.recordEvent(campaign, lead, 'email_send_failed', {
          recipient,
          subject: message.subject,
          error: error instanceof Error ? error.message : 'unknown error'
        });
        eventIds.push(event.id);
        failedCount += 1;
      }
    }

    const status = sentCount > 0 && failedCount === 0 && skippedCount === 0
      ? 'sent'
      : sentCount > 0
        ? 'partial'
        : skippedCount > 0 && failedCount === 0
          ? 'skipped'
          : 'failed';

    await this.repos.audit({
      actorType: 'system',
      action: 'campaign_email_send_completed',
      entityType: 'campaign',
      entityId: campaign.id,
      metadata: {
        sentCount,
        skippedCount,
        failedCount,
        eventIds
      }
    });

    return {
      ok: sentCount > 0 && failedCount === 0,
      campaignId,
      status,
      sentCount,
      skippedCount,
      failedCount,
      eventIds
    };
  }

  private async recordEvent(
    campaign: CampaignRecord,
    lead: LeadRecord,
    eventType: string,
    payload: Record<string, unknown>
  ) {
    return this.repos.createCampaignEvent({
      campaignId: campaign.id,
      leadId: lead.id,
      eventType,
      payload: {
        channel: 'email',
        source: 'nodemailer_campaign_sender',
        campaignName: campaign.name,
        leadName: lead.name,
        noApprovalRequired: true,
        ...payload
      }
    });
  }
}

function buildMessage(campaign: CampaignRecord, lead: LeadRecord, recipient: string, from: string) {
  const drafts = Array.isArray(campaign.metadata.outreachDrafts)
    ? campaign.metadata.outreachDrafts.filter((item): item is string => typeof item === 'string')
    : [];
  const subject = drafts.find((item) => /^主题[:：]/.test(item))?.replace(/^主题[:：]\s*/, '').trim()
    || `想和你们聊聊${lead.name ? `：${lead.name}` : ''}`;
  const body = drafts
    .filter((item) => !/^主题[:：]/.test(item))
    .join('\n\n')
    .trim()
    || [
      `你好，我在整理 ${lead.name} 的公开信息，想确认是否有合作或效率提升空间。`,
      '如果你方便，我可以先发一份简短诊断清单。'
    ].join('\n\n');

  return {
    from,
    to: recipient,
    subject,
    text: [
      body,
      '',
      '--',
      '如果不方便继续沟通，回复“停止联系”即可。'
    ].join('\n')
  };
}

function emailForLead(lead: LeadRecord) {
  const fields = isRecord(lead.metadata.enrichmentFields) ? lead.metadata.enrichmentFields : {};
  const direct = firstString(fields.publicEmail, fields.email, lead.metadata.publicEmail, lead.metadata.email);
  if (direct) return direct;
  if (Array.isArray(lead.metadata.sources)) {
    for (const source of lead.metadata.sources) {
      if (isRecord(source)) {
        const email = firstString(source.email, source.publicEmail);
        if (email) return email;
      }
    }
  }
  return undefined;
}

function emptyResult(campaignId: string, status: CampaignSendResult['status'], reason: string): CampaignSendResult {
  return {
    ok: false,
    campaignId,
    status,
    sentCount: 0,
    skippedCount: 0,
    failedCount: status === 'failed' ? 1 : 0,
    eventIds: [],
    reason
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
