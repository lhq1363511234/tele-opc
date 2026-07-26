import { resolveFeishuTableId } from './base-tables.js';

type FetchLike = typeof fetch;

export interface FeishuBaseClientOptions {
  appId: string;
  appSecret: string;
  appToken: string;
  /** Feishu open platform host. Defaults to the international/China shared gateway. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Optional injectable clock for token expiry, mainly for tests. */
  now?: () => number;
}

export interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface TokenState {
  token: string;
  expiresAt: number;
}

/**
 * Minimal Feishu (Lark) Bitable REST client used by the operating ledger mirror.
 *
 * It talks to the open platform directly with a tenant access token, so it does
 * not depend on the `lark-cli` binary being installed on the host. All network
 * access goes through an injectable fetch to keep the client unit-testable.
 */
export class FeishuBaseClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly appToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private tokenState: TokenState | null = null;
  private readonly fieldCache = new Map<string, { names: Set<string>; expiresAt: number }>();

  constructor(options: FeishuBaseClientOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.appToken = options.appToken;
    this.baseUrl = (options.baseUrl ?? 'https://open.feishu.cn/open-apis').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private async request<T>(path: string, init: RequestInit, auth = true): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      ...((init.headers as Record<string, string>) ?? {})
    };
    if (auth) headers.authorization = `Bearer ${await this.getTenantToken()}`;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const payload = (await response.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: unknown;
    } & Record<string, unknown>;

    if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
      const code = payload.code ?? response.status;
      const msg = payload.msg ?? response.statusText;
      throw new Error(`Feishu API ${path} failed: code=${code} msg=${msg}`);
    }
    return payload as T;
  }

  async getTenantToken(): Promise<string> {
    if (this.tokenState && this.tokenState.expiresAt > this.now() + 30_000) {
      return this.tokenState.token;
    }
    const payload = await this.request<{ tenant_access_token?: string; expire?: number }>(
      '/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret })
      },
      false
    );
    if (!payload.tenant_access_token) {
      throw new Error('Feishu tenant_access_token missing in response');
    }
    this.tokenState = {
      token: payload.tenant_access_token,
      expiresAt: this.now() + (payload.expire ?? 7200) * 1000
    };
    return this.tokenState.token;
  }

  /** Find records where a text field equals a value. Used for id-based upsert. */
  async findRecordsByField(
    tableNameOrId: string,
    fieldName: string,
    value: string
  ): Promise<FeishuRecord[]> {
    const tableId = resolveFeishuTableId(tableNameOrId);
    const payload = await this.request<{ data?: { items?: FeishuRecord[] } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: fieldName, operator: 'is', value: [value] }]
          },
          automatic_fields: false
        })
      }
    );
    return payload.data?.items ?? [];
  }

  /** Read a bounded page of Base records for read-only analytics. */
  async listRecords(
    tableNameOrId: string,
    options: { pageSize?: number; pageToken?: string } = {}
  ): Promise<{ items: FeishuRecord[]; hasMore: boolean; pageToken?: string }> {
    const tableId = resolveFeishuTableId(tableNameOrId);
    const params = new URLSearchParams({ page_size: String(Math.min(500, Math.max(1, options.pageSize ?? 100))) });
    if (options.pageToken) params.set('page_token', options.pageToken);
    const payload = await this.request<{ data?: { items?: FeishuRecord[]; has_more?: boolean; page_token?: string } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records?${params.toString()}`,
      { method: 'GET' }
    );
    return {
      items: payload.data?.items ?? [],
      hasMore: Boolean(payload.data?.has_more),
      pageToken: payload.data?.page_token
    };
  }

  /**
   * Field names that actually exist on a Base table, cached for 5 minutes.
   * Used to drop unknown keys before writing so one stale mapper field cannot
   * fail the whole record with FieldNameNotFound.
   */
  async listFieldNames(tableNameOrId: string): Promise<Set<string>> {
    const tableId = resolveFeishuTableId(tableNameOrId);
    const cached = this.fieldCache.get(tableId);
    if (cached && cached.expiresAt > this.now()) return cached.names;

    const payload = await this.request<{ data?: { items?: Array<{ field_name?: string }> } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields?page_size=200`,
      { method: 'GET' }
    );
    const names = new Set(
      (payload.data?.items ?? []).map((item) => item.field_name).filter((name): name is string => Boolean(name))
    );
    this.fieldCache.set(tableId, { names, expiresAt: this.now() + 300_000 });
    return names;
  }

  /** Removes keys the target table does not define, and empty/undefined values. */
  private async sanitizeFields(
    tableNameOrId: string,
    fields: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let known: Set<string>;
    try {
      known = await this.listFieldNames(tableNameOrId);
    } catch {
      return fields;
    }
    if (known.size === 0) return fields;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!known.has(key)) continue;
      if (value === undefined) continue;
      out[key] = value;
    }
    return out;
  }

  async createRecord(tableNameOrId: string, fields: Record<string, unknown>): Promise<FeishuRecord> {
    const tableId = resolveFeishuTableId(tableNameOrId);
    const safeFields = await this.sanitizeFields(tableNameOrId, fields);
    const payload = await this.request<{ data?: { record?: FeishuRecord } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`,
      { method: 'POST', body: JSON.stringify({ fields: safeFields }) }
    );
    if (!payload.data?.record) throw new Error('Feishu createRecord returned no record');
    return payload.data.record;
  }

  async updateRecord(
    tableNameOrId: string,
    recordId: string,
    fields: Record<string, unknown>
  ): Promise<FeishuRecord> {
    const tableId = resolveFeishuTableId(tableNameOrId);
    const safeFields = await this.sanitizeFields(tableNameOrId, fields);
    const payload = await this.request<{ data?: { record?: FeishuRecord } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`,
      { method: 'PUT', body: JSON.stringify({ fields: safeFields }) }
    );
    if (!payload.data?.record) throw new Error('Feishu updateRecord returned no record');
    return payload.data.record;
  }


  /** Batch-create records (max 500 per Feishu API call). */
  async batchCreateRecords(
    tableNameOrId: string,
    records: Array<Record<string, unknown>>
  ): Promise<FeishuRecord[]> {
    if (!records.length) return [];
    const tableId = resolveFeishuTableId(tableNameOrId);
    const safeRecords = await Promise.all(records.map((fields) => this.sanitizeFields(tableNameOrId, fields)));
    const payload = await this.request<{ data?: { records?: FeishuRecord[] } }>(
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        body: JSON.stringify({
          records: safeRecords.map((fields) => ({ fields }))
        })
      }
    );
    return payload.data?.records ?? [];
  }

  /**
   * Upsert a record by matching a stable id field (default `id`). Returns the
   * record id and whether it was created or updated.
   */
  async upsertByIdField(
    tableNameOrId: string,
    fields: Record<string, unknown>,
    idField = 'id'
  ): Promise<{ recordId: string; created: boolean }> {
    const idValue = fields[idField];
    if (typeof idValue !== 'string' || idValue.length === 0) {
      throw new Error(`upsertByIdField requires a string "${idField}" field`);
    }
    const existing = await this.findRecordsByField(tableNameOrId, idField, idValue);
    if (existing.length > 0) {
      const record = await this.updateRecord(tableNameOrId, existing[0].record_id, fields);
      return { recordId: record.record_id, created: false };
    }
    const record = await this.createRecord(tableNameOrId, fields);
    return { recordId: record.record_id, created: true };
  }
}
