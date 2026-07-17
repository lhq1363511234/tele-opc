import { describe, expect, it } from 'vitest';
import { CampaignEmailSender, NodemailerMailTransport, type MailTransport } from '../src/email/campaignEmailSender.js';
import type { AuditLogRecord, CampaignEventRecord, CampaignRecord, LeadRecord } from '../src/types.js';

describe('CampaignEmailSender', () => {
  it('sends campaign emails with Nodemailer-compatible transport and records events', async () => {
    const repos = new FakeCampaignRepos();
    const transport = new FakeMailTransport();
    const sender = new CampaignEmailSender(repos, transport, 'founder@example.com');

    const result = await sender.sendCampaign('cmp_1');

    expect(result).toMatchObject({
      ok: true,
      status: 'partial',
      sentCount: 1,
      skippedCount: 1,
      failedCount: 0
    });
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toMatchObject({
      from: 'founder@example.com',
      to: 'lead@example.com',
      subject: '想和你们聊聊企业数字化'
    });
    expect(repos.events).toHaveLength(2);
    expect(repos.events[0]).toMatchObject({
      campaign_id: 'cmp_1',
      lead_id: 'lead_1',
      event_type: 'email_sent'
    });
    expect(repos.events[1]).toMatchObject({
      campaign_id: 'cmp_1',
      lead_id: 'lead_2',
      event_type: 'email_send_skipped'
    });
    expect(repos.audits.map((audit) => audit.action)).toContain('campaign_email_send_completed');
  });

  it('treats SMTP auth without password as not configured', () => {
    const previous = {
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASSWORD: process.env.SMTP_PASSWORD,
      SMTP_FROM: process.env.SMTP_FROM
    };
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_USER = 'founder@example.com';
    process.env.SMTP_FROM = 'founder@example.com';
    delete process.env.SMTP_PASSWORD;

    try {
      expect(NodemailerMailTransport.fromEnv()).toBeNull();
    } finally {
      restoreEnv(previous);
    }
  });
});

function restoreEnv(previous: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

class FakeMailTransport implements MailTransport {
  readonly messages: Array<{ from: string; to: string; subject: string; text: string }> = [];

  async sendMail(message: { from: string; to: string; subject: string; text: string }) {
    this.messages.push(message);
    return {
      messageId: `msg_${this.messages.length}`,
      response: '250 OK',
      accepted: [message.to],
      rejected: []
    };
  }
}

class FakeCampaignRepos {
  readonly events: CampaignEventRecord[] = [];
  readonly audits: AuditLogRecord[] = [];
  readonly campaign: CampaignRecord = {
    id: 'cmp_1',
    prospecting_run_id: 'prn_1',
    name: 'V3 Prospecting draft campaign',
    status: 'draft',
    audience: {},
    metadata: {
      outreachDrafts: [
        '主题：想和你们聊聊企业数字化',
        '你好，看到你们可能在做系统升级，想发一份简短诊断清单。'
      ]
    },
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z'
  };
  readonly leads: LeadRecord[] = [
    {
      id: 'lead_1',
      prospecting_run_id: 'prn_1',
      organization_id: null,
      contact_id: null,
      name: 'Lead With Email',
      status: 'new',
      source: 'public_source',
      score: {},
      metadata: {
        enrichmentFields: {
          publicEmail: 'lead@example.com'
        }
      },
      created_at: '2026-06-11T00:00:00.000Z',
      updated_at: '2026-06-11T00:00:00.000Z'
    },
    {
      id: 'lead_2',
      prospecting_run_id: 'prn_1',
      organization_id: null,
      contact_id: null,
      name: 'Lead Without Email',
      status: 'new',
      source: 'public_source',
      score: {},
      metadata: {},
      created_at: '2026-06-11T00:00:00.000Z',
      updated_at: '2026-06-11T00:00:00.000Z'
    }
  ];

  async getCampaign(id: string) {
    return id === this.campaign.id ? this.campaign : null;
  }

  async listLeadsForProspectingRun(prospectingRunId: string) {
    return this.leads.filter((lead) => lead.prospecting_run_id === prospectingRunId);
  }

  async createCampaignEvent(params: {
    campaignId?: string | null;
    leadId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  }) {
    const event: CampaignEventRecord = {
      id: `cev_${this.events.length + 1}`,
      campaign_id: params.campaignId ?? null,
      lead_id: params.leadId ?? null,
      event_type: params.eventType,
      payload: params.payload ?? {},
      created_at: '2026-06-11T00:00:00.000Z'
    };
    this.events.push(event);
    return event;
  }

  async audit(params: {
    actorType: string;
    actorId?: string;
    action: string;
    entityType?: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const audit: AuditLogRecord = {
      id: `aud_${this.audits.length + 1}`,
      actor_type: params.actorType,
      actor_id: params.actorId ?? null,
      action: params.action,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? {},
      created_at: '2026-06-11T00:00:00.000Z'
    };
    this.audits.push(audit);
    return audit;
  }
}
