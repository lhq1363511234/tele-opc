import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BackupRunRecord } from '../types.js';

export const defaultBackupTables = [
  'users',
  'telegram_chats',
  'messages',
  'tasks',
  'task_events',
  'approvals',
  'audit_logs',
  'schema_migrations',
  'memories',
  'memory_sources',
  'task_dependencies',
  'reviews',
  'playbooks',
  'artifacts',
  'briefings',
  'organizations',
  'contacts',
  'opportunities',
  'interactions',
  'follow_ups',
  'customer_segments',
  'email_accounts',
  'email_threads',
  'email_messages',
  'email_drafts',
  'vendors',
  'invoices',
  'subscriptions',
  'transactions',
  'budgets',
  'cashflow_snapshots',
  'calendar_accounts',
  'calendar_events',
  'meeting_notes',
  'availability_windows',
  'browser_sessions',
  'browser_runs',
  'browser_steps',
  'browser_screenshots',
  'browser_extractions',
  'browser_blocked_actions',
  'retry_events',
  'integration_health_checks',
  'audit_exports',
  'backup_runs',
  'evaluation_cases',
  'evaluation_runs',
  'evaluation_results',
  'permission_profiles'
] as const;

export interface BackupRepositories {
  createBackupRun(params: {
    requestedByUserId?: string;
    backupType?: string;
    status?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BackupRunRecord>;
  updateBackupRunStatus(id: string, params: {
    status: string;
    artifactPath?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): Promise<BackupRunRecord | null>;
  listBackupTableRows(tableName: string, limit?: number): Promise<Array<Record<string, unknown>>>;
}

export interface BackupTableResult {
  table: string;
  rowCount: number;
  file: string;
}

export interface BackupResult {
  record: BackupRunRecord;
  artifactPath: string;
  tableCount: number;
  rowCount: number;
  tables: BackupTableResult[];
}

export class LocalBackupRunner {
  constructor(
    private readonly repos: BackupRepositories,
    private readonly artifactRoot = path.join('runtime', 'artifacts', 'backups')
  ) {}

  async runManual(params: {
    requestedByUserId?: string;
    rowLimit?: number;
  }): Promise<BackupResult> {
    const rowLimit = clampBackupRowLimit(params.rowLimit);
    const run = await this.repos.createBackupRun({
      requestedByUserId: params.requestedByUserId,
      backupType: 'manual_jsonl',
      status: 'running',
      notes: `Manual JSONL backup with ${rowLimit} rows per table.`,
      metadata: {
        rowLimit,
        tableCount: defaultBackupTables.length,
        source: 'telegram_command'
      }
    });

    const backupDir = path.join(this.artifactRoot, run.id);

    try {
      await mkdir(backupDir, { recursive: true });
      const tables: BackupTableResult[] = [];
      let rowCount = 0;

      for (const table of defaultBackupTables) {
        const rows = await this.repos.listBackupTableRows(table, rowLimit);
        const file = `${table}.jsonl`;
        const content = rows.map((row) => JSON.stringify(row)).join('\n');
        await writeFile(path.join(backupDir, file), content ? `${content}\n` : '', 'utf8');
        tables.push({
          table,
          rowCount: rows.length,
          file
        });
        rowCount += rows.length;
      }

      const manifest = {
        id: run.id,
        backupType: 'manual_jsonl',
        createdAt: new Date().toISOString(),
        rowLimit,
        tableCount: tables.length,
        rowCount,
        tables
      };
      await writeFile(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const completed = await this.repos.updateBackupRunStatus(run.id, {
        status: 'completed',
        artifactPath: backupDir,
        notes: `Exported ${rowCount} rows from ${tables.length} tables.`,
        metadata: {
          rowLimit,
          tableCount: tables.length,
          rowCount,
          completedAt: new Date().toISOString()
        }
      });

      return {
        record: completed ?? run,
        artifactPath: backupDir,
        tableCount: tables.length,
        rowCount,
        tables
      };
    } catch (error) {
      await this.repos.updateBackupRunStatus(run.id, {
        status: 'failed',
        notes: error instanceof Error ? error.message : 'unknown error',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error',
          failedAt: new Date().toISOString()
        }
      });
      throw error;
    }
  }
}

export function clampBackupRowLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 5000;
  return Math.max(1, Math.min(Math.trunc(value!), 50000));
}
