import { PoolClient } from 'pg';
import { getPool } from './pool';

/**
 * Runs `fn` inside a BEGIN/COMMIT, rolling back on any thrown error.
 * Always releases the client back to the pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
