import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool.js';
import { logger } from '../logger.js';

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await pool.query('SELECT id FROM schema_migrations WHERE id = $1', [file]);
    if (applied.rowCount) {
      logger.info({ migration: file }, 'migration already applied');
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      logger.info({ migration: file }, 'migration applied');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

main()
  .catch((error) => {
    logger.error({ error }, 'migration failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

