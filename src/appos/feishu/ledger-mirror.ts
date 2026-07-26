import type { ApprovalRecord, ArtifactRecord, BusinessAnalyticsFactRecord, LeadRecord, TaskRecord } from '../../types.js';
import { FeishuBaseClient } from './base-client.js';
import type { LedgerDriver, LedgerUpsertResult } from './ledger-driver.js';
import { NoopLedgerDriver, OpenApiLedgerDriver } from './ledger-driver.js';
import {
  approvalToFeishuFields,
  artifactToFeishuFields,
  analyticsFactToFeishuFields,
  leadToFeishuFields,
  taskToFeishuFields
} from './ledger-mappers.js';

export interface FeishuMirrorConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  baseUrl?: string;
}

export interface FeishuMirrorOptions {
  publicBaseUrl: string;
  driver: LedgerDriver;
}

/**
 * Projects Tele-OPC operating objects (tasks, approvals, leads, artifacts) into
 * a Feishu Base so the owner can review the business ledger in Feishu instead of
 * only in Telegram. Phase A is a one-way projection: Postgres -> Feishu upsert.
 */
export class FeishuMirror {
  constructor(private readonly options: FeishuMirrorOptions) {}

  get mode(): LedgerDriver['mode'] {
    return this.options.driver.mode;
  }

  private get baseCtx() {
    return { publicBaseUrl: this.options.publicBaseUrl };
  }

  async mirrorTask(task: TaskRecord): Promise<LedgerUpsertResult> {
    return this.options.driver.upsert('task', taskToFeishuFields(task, this.baseCtx));
  }

  async mirrorApproval(approval: ApprovalRecord): Promise<LedgerUpsertResult> {
    return this.options.driver.upsert('approval', approvalToFeishuFields(approval, this.baseCtx));
  }

  async mirrorLead(lead: LeadRecord): Promise<LedgerUpsertResult> {
    return this.options.driver.upsert('lead', leadToFeishuFields(lead, this.baseCtx));
  }

  async mirrorArtifact(artifact: ArtifactRecord): Promise<LedgerUpsertResult> {
    return this.options.driver.upsert('artifact', artifactToFeishuFields(artifact, this.baseCtx));
  }

  async mirrorAnalyticsFact(fact: BusinessAnalyticsFactRecord): Promise<LedgerUpsertResult> {
    return this.options.driver.upsert('analytics', analyticsFactToFeishuFields(fact));
  }
}

export interface BuildFeishuMirrorInput {
  publicBaseUrl: string;
  appToken?: string;
  appId?: string;
  appSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Builds a FeishuMirror. When app credentials are present, it uses the live
 * OpenAPI driver; otherwise it falls back to the dry-run driver so the rest of
 * the system keeps working (and can be verified) without Feishu access.
 */
export function buildFeishuMirror(input: BuildFeishuMirrorInput): FeishuMirror {
  const hasCredentials = Boolean(input.appId && input.appSecret && input.appToken);
  if (hasCredentials) {
    const client = new FeishuBaseClient({
      appId: input.appId as string,
      appSecret: input.appSecret as string,
      appToken: input.appToken as string,
      baseUrl: input.baseUrl,
      fetch: input.fetchImpl
    });
    return new FeishuMirror({
      publicBaseUrl: input.publicBaseUrl,
      driver: new OpenApiLedgerDriver(client)
    });
  }
  return new FeishuMirror({
    publicBaseUrl: input.publicBaseUrl,
    driver: new NoopLedgerDriver()
  });
}
