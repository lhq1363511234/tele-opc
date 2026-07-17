import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditExportRecord, AuditLogRecord } from '../types.js';

export interface AuditExportRepositories {
  createAuditExport(params: {
    requestedByUserId?: string;
    scope?: string;
    format?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditExportRecord>;
  updateAuditExportStatus(id: string, params: {
    status: string;
    artifactPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditExportRecord | null>;
  listAuditLogs(limit?: number): Promise<AuditLogRecord[]>;
}

export interface AuditExportResult {
  record: AuditExportRecord;
  artifactPath: string;
  rowCount: number;
}

export class LocalAuditExporter {
  constructor(
    private readonly repos: AuditExportRepositories,
    private readonly artifactDir = path.join('runtime', 'artifacts', 'audit')
  ) {}

  async exportRecent(params: {
    requestedByUserId?: string;
    limit?: number;
  }): Promise<AuditExportResult> {
    const limit = clampAuditExportLimit(params.limit);
    const exportRecord = await this.repos.createAuditExport({
      requestedByUserId: params.requestedByUserId,
      scope: `recent:${limit}`,
      format: 'jsonl',
      status: 'running',
      metadata: {
        requestedLimit: limit,
        source: 'telegram_command'
      }
    });

    try {
      const rows = await this.repos.listAuditLogs(limit);
      await mkdir(this.artifactDir, { recursive: true });
      const artifactPath = path.join(
        this.artifactDir,
        `${exportRecord.id}-${safeTimestamp(new Date())}.jsonl`
      );
      const content = rows
        .slice()
        .reverse()
        .map((row) => JSON.stringify(row))
        .join('\n');
      await writeFile(artifactPath, content ? `${content}\n` : '', 'utf8');
      const completed = await this.repos.updateAuditExportStatus(exportRecord.id, {
        status: 'completed',
        artifactPath,
        metadata: {
          rowCount: rows.length,
          completedAt: new Date().toISOString()
        }
      });

      return {
        record: completed ?? exportRecord,
        artifactPath,
        rowCount: rows.length
      };
    } catch (error) {
      await this.repos.updateAuditExportStatus(exportRecord.id, {
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error',
          failedAt: new Date().toISOString()
        }
      });
      throw error;
    }
  }
}

export function clampAuditExportLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) return 200;
  return Math.max(1, Math.min(Math.trunc(value!), 1000));
}

function safeTimestamp(value: Date) {
  return value.toISOString().replace(/[:.]/g, '-');
}
