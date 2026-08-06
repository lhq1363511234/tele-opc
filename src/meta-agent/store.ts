import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  DiscoveredComponent,
  MetaAgentAttemptRecord,
  MetaAgentBlueprint,
  MetaAgentBlueprintRecord,
  MetaAgentComponentRecord,
  MetaAgentRunRecord
} from './contracts.js';

export class MetaAgentStore {
  constructor(private readonly pool: pg.Pool) {}

  async createBlueprint(params: { requirement: string; blueprint: MetaAgentBlueprint; createdBy?: string }) {
    const id = `mab_${randomUUID()}`;
    const result = await this.pool.query(
      `INSERT INTO meta_agent_blueprints (id, requirement, system_name, blueprint, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, params.requirement, params.blueprint.systemName, JSON.stringify(params.blueprint), params.createdBy ?? null]
    );
    return result.rows[0] as MetaAgentBlueprintRecord;
  }

  async getBlueprint(id: string) {
    const result = await this.pool.query('SELECT * FROM meta_agent_blueprints WHERE id = $1', [id]);
    return (result.rows[0] as MetaAgentBlueprintRecord | undefined) ?? null;
  }

  async listBlueprints(limit = 20) {
    const result = await this.pool.query(
      'SELECT * FROM meta_agent_blueprints ORDER BY created_at DESC LIMIT $1',
      [Math.max(1, Math.min(limit, 100))]
    );
    return result.rows as MetaAgentBlueprintRecord[];
  }

  async replaceComponents(blueprintId: string, components: DiscoveredComponent[]) {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM meta_agent_components WHERE blueprint_id = $1', [blueprintId]);
        const rows: MetaAgentComponentRecord[] = [];
        for (const [index, component] of components.entries()) {
          const id = `mac_${randomUUID()}`;
          const result = await client.query(
            `INSERT INTO meta_agent_components (
               id, blueprint_id, source, external_id, name, description, url, version, stars, score, status, metadata
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [
              id,
              blueprintId,
              component.source,
              component.externalId,
              component.name,
              component.description || null,
              component.url ?? null,
              component.version ?? null,
              component.stars ?? 0,
              component.score,
              index === 0 ? 'selected' : 'staged_reference',
              JSON.stringify(component.metadata)
            ]
          );
          rows.push(normalizeComponent(result.rows[0]));
        }
        await client.query(
          `UPDATE meta_agent_blueprints SET status = $2, updated_at = now() WHERE id = $1`,
          [blueprintId, rows.length ? 'assembled' : 'planned']
        );
        await client.query('COMMIT');
        return rows;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async listComponents(blueprintId: string) {
    const result = await this.pool.query(
      'SELECT * FROM meta_agent_components WHERE blueprint_id = $1 ORDER BY score DESC, created_at ASC',
      [blueprintId]
    );
    return result.rows.map(normalizeComponent);
  }

  async createRun(params: { blueprintId: string; taskInput: string; metadata?: Record<string, unknown> }) {
    const id = `mar_${randomUUID()}`;
    const result = await this.pool.query(
      `INSERT INTO meta_agent_runs (id, blueprint_id, task_input, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, params.blueprintId, params.taskInput, JSON.stringify(params.metadata ?? {})]
    );
    return result.rows[0] as MetaAgentRunRecord;
  }

  async createAttempt(params: {
    runId: string;
    attemptNo: number;
    componentId?: string;
    producerRole: string;
    auditorRole: string;
    output: string;
    auditStatus: 'passed' | 'failed';
    auditScore: number;
    feedback?: string;
    metadata?: Record<string, unknown>;
  }) {
    const id = `maa_${randomUUID()}`;
    const result = await this.pool.query(
      `INSERT INTO meta_agent_attempts (
         id, run_id, attempt_no, component_id, producer_role, auditor_role, output,
         audit_status, audit_score, feedback, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        id,
        params.runId,
        params.attemptNo,
        params.componentId ?? null,
        params.producerRole,
        params.auditorRole,
        params.output,
        params.auditStatus,
        params.auditScore,
        params.feedback ?? null,
        JSON.stringify(params.metadata ?? {})
      ]
    );
    return normalizeAttempt(result.rows[0]);
  }

  async completeRun(params: {
    runId: string;
    status: 'passed' | 'failed';
    selectedComponentId?: string;
    finalOutput: string;
    auditSummary: Record<string, unknown>;
  }) {
    const result = await this.pool.query(
      `UPDATE meta_agent_runs
       SET status = $2, selected_component_id = $3, final_output = $4, audit_summary = $5,
           completed_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [params.runId, params.status, params.selectedComponentId ?? null, params.finalOutput, JSON.stringify(params.auditSummary)]
    );
    return result.rows[0] as MetaAgentRunRecord;
  }

  async failRun(runId: string, error: string) {
    const result = await this.pool.query(
      `UPDATE meta_agent_runs
       SET status = 'failed', audit_summary = $2, completed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [runId, JSON.stringify({ error: error.slice(0, 2000) })]
    );
    return result.rows[0] as MetaAgentRunRecord;
  }

  async listRuns(limit = 30) {
    const result = await this.pool.query(
      `SELECT * FROM meta_agent_runs ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))]
    );
    return result.rows as MetaAgentRunRecord[];
  }

  async getRun(id: string) {
    const [runResult, attemptResult] = await Promise.all([
      this.pool.query('SELECT * FROM meta_agent_runs WHERE id = $1', [id]),
      this.pool.query('SELECT * FROM meta_agent_attempts WHERE run_id = $1 ORDER BY attempt_no ASC', [id])
    ]);
    const run = runResult.rows[0] as MetaAgentRunRecord | undefined;
    if (!run) return null;
    return { run, attempts: attemptResult.rows.map(normalizeAttempt) };
  }
}

function normalizeComponent(row: Record<string, unknown>) {
  return {
    ...row,
    stars: Number(row.stars ?? 0),
    score: Number(row.score ?? 0)
  } as MetaAgentComponentRecord;
}

function normalizeAttempt(row: Record<string, unknown>) {
  return {
    ...row,
    attempt_no: Number(row.attempt_no ?? 0),
    audit_score: Number(row.audit_score ?? 0)
  } as MetaAgentAttemptRecord;
}
