import type { Repositories } from '../../db/repositories.js';
import { logger } from '../../logger.js';
import type { FeishuMirror } from './ledger-mirror.js';
import type { LedgerUpsertResult } from './ledger-driver.js';
import type { LedgerObjectKind } from './ledger-mappers.js';

export interface LedgerSyncOptions {
  taskLimit?: number;
  approvalLimit?: number;
  leadLimit?: number;
  artifactLimit?: number;
  analyticsLimit?: number;
}

export interface LedgerSyncSummary {
  mode: FeishuMirror['mode'];
  startedAt: string;
  finishedAt: string;
  counts: Record<LedgerObjectKind, { attempted: number; created: number; updated: number; skipped: number; failed: number }>;
  results: LedgerUpsertResult[];
  errors: Array<{ kind: LedgerObjectKind; id: string; message: string }>;
}

const emptyCount = () => ({ attempted: 0, created: 0, updated: 0, skipped: 0, failed: 0 });

/**
 * Batch projection of the operating ledger into Feishu. Pulls the most recent
 * tasks, approvals, leads and artifacts from Postgres and upserts them through
 * the mirror. Errors on individual records are collected, not thrown, so one
 * bad row does not abort the whole sync.
 */
export class LedgerSync {
  constructor(
    private readonly repos: Repositories,
    private readonly mirror: FeishuMirror
  ) {}

  async run(options: LedgerSyncOptions = {}): Promise<LedgerSyncSummary> {
    const startedAt = new Date().toISOString();
    const counts: LedgerSyncSummary['counts'] = {
      task: emptyCount(),
      approval: emptyCount(),
      lead: emptyCount(),
      artifact: emptyCount(),
      analytics: emptyCount()
    };
    const results: LedgerUpsertResult[] = [];
    const errors: LedgerSyncSummary['errors'] = [];

    const record = (kind: LedgerObjectKind, id: string, fn: () => Promise<LedgerUpsertResult>) =>
      fn()
        .then((res) => {
          counts[kind].attempted += 1;
          if (res.skipped) counts[kind].skipped += 1;
          else if (res.created) counts[kind].created += 1;
          else counts[kind].updated += 1;
          results.push(res);
        })
        .catch((error) => {
          counts[kind].attempted += 1;
          counts[kind].failed += 1;
          const message = error instanceof Error ? error.message : 'unknown error';
          errors.push({ kind, id, message });
          logger.warn({ kind, id, message }, 'ledger sync record failed');
        });

    const tasks = await this.repos.listTasks(options.taskLimit ?? 50);
    for (const task of tasks) await record('task', task.id, () => this.mirror.mirrorTask(task));

    const approvals = await this.repos.listPendingApprovals(options.approvalLimit ?? 50);
    for (const approval of approvals) await record('approval', approval.id, () => this.mirror.mirrorApproval(approval));

    const leads = await this.repos.listProspectingLeads(options.leadLimit ?? 50);
    for (const lead of leads) await record('lead', lead.id, () => this.mirror.mirrorLead(lead));

    const taskIds = tasks.map((t) => t.id);
    const artifacts = taskIds.length ? await this.repos.listArtifactsForTaskIds(taskIds, options.artifactLimit ?? 50) : [];
    for (const artifact of artifacts) await record('artifact', artifact.id, () => this.mirror.mirrorArtifact(artifact));

    const facts = await this.repos.listBusinessAnalyticsFacts(options.analyticsLimit ?? 100);
    for (const fact of facts) await record('analytics', fact.id, () => this.mirror.mirrorAnalyticsFact(fact));

    return {
      mode: this.mirror.mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      counts,
      results,
      errors
    };
  }
}
