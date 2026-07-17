import pg from 'pg';
import { loadConfig } from '../config/index.js';

const { Pool } = pg;
const config = loadConfig();

export const pool = new Pool({
  connectionString: config.database.url
});

export async function pingDatabase() {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

