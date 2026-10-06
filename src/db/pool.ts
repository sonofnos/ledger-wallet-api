import { Pool } from 'pg';
import { config } from '../config';

let pool: Pool | undefined;

/**
 * Lazily creates a singleton pool from the current `config`. Tests that spin
 * up a fresh Testcontainers Postgres call `resetPool()` after mutating
 * `config.db.*` so a new pool is created against the right host/port instead
 * of reusing a pool opened against defaults.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      max: config.db.poolMax,
    });
    // node-postgres gotcha: an idle client that loses its connection (e.g.
    // the server going away) emits 'error' on the Pool. With no listener,
    // that's an unhandled 'error' event, which Node treats as fatal and
    // crashes the process. Hit this for real when a Testcontainers
    // Postgres stopped at the end of a test run while the pool still had
    // idle connections open. Logging and swallowing it is the documented
    // fix; the pool removes the broken client and keeps serving new ones.
    pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('Postgres pool idle client error (swallowed):', err.message);
    });
  }
  return pool;
}

export async function resetPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
