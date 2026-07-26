import { FeishuBaseClient } from './base-client.js';
import { resolveFeishuTableId } from './base-tables.js';
import type { LedgerObjectKind } from './ledger-mappers.js';
import { LEDGER_TABLES } from './ledger-mappers.js';

export interface LedgerUpsertResult {
  kind: LedgerObjectKind;
  table: string;
  id: string;
  recordId: string | null;
  created: boolean;
  skipped: boolean;
  reason?: string;
}

/**
 * A pluggable write target for the operating ledger mirror. `noop` records
 * intended writes without touching the network (used when Feishu credentials
 * are not configured or in tests). `openapi` writes to Feishu Bitable directly.
 */
export interface LedgerDriver {
  readonly mode: 'noop' | 'openapi';
  upsert(kind: LedgerObjectKind, fields: Record<string, unknown>): Promise<LedgerUpsertResult>;
}

const idOf = (fields: Record<string, unknown>): string =>
  typeof fields.id === 'string' ? fields.id : '';

/**
 * Dry-run driver: resolves the target table if possible and reports what would
 * be written, but performs no network calls. Safe to run without credentials.
 */
export class NoopLedgerDriver implements LedgerDriver {
  readonly mode = 'noop' as const;
  public readonly writes: LedgerUpsertResult[] = [];

  async upsert(kind: LedgerObjectKind, fields: Record<string, unknown>): Promise<LedgerUpsertResult> {
    let table: string = LEDGER_TABLES[kind];
    let reason: string | undefined;
    try {
      table = resolveFeishuTableId(LEDGER_TABLES[kind]);
    } catch (error) {
      reason = error instanceof Error ? error.message : 'table not resolvable';
    }
    const result: LedgerUpsertResult = {
      kind,
      table,
      id: idOf(fields),
      recordId: null,
      created: false,
      skipped: true,
      reason: reason ?? 'noop driver (no credentials configured)'
    };
    this.writes.push(result);
    return result;
  }
}

/** Live driver that upserts records into Feishu Bitable via the REST client. */
export class OpenApiLedgerDriver implements LedgerDriver {
  readonly mode = 'openapi' as const;

  constructor(private readonly client: FeishuBaseClient) {}

  async upsert(kind: LedgerObjectKind, fields: Record<string, unknown>): Promise<LedgerUpsertResult> {
    const logical = LEDGER_TABLES[kind];
    let table: string = logical;
    try {
      table = resolveFeishuTableId(logical);
    } catch (error) {
      return {
        kind,
        table: logical,
        id: idOf(fields),
        recordId: null,
        created: false,
        skipped: true,
        reason: error instanceof Error ? error.message : 'table not resolvable'
      };
    }

    const { recordId, created } = await this.client.upsertByIdField(table, fields, 'id');
    return { kind, table, id: idOf(fields), recordId, created, skipped: false };
  }
}
