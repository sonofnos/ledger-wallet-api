import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Starts a real, throwaway Postgres 16 via Testcontainers for the
 * integration suite. Needs nothing pre-installed beyond Docker, same on a
 * laptop and on a CI runner, no docker-compose services required.
 */
export default async function globalSetup(): Promise<void> {
  const pg: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ledger_wallet_test')
    .withUsername('ledger')
    .withPassword('ledger')
    // Room for the concurrency tests' parallel connections.
    .withCommand(['postgres', '-c', 'max_connections=200'])
    .start();

  (globalThis as any).__PG_CONTAINER__ = pg;

  Object.assign(process.env, {
    DB_HOST: pg.getHost(),
    DB_PORT: String(pg.getPort()),
    DB_USER: 'ledger',
    DB_PASSWORD: 'ledger',
    DB_NAME: 'ledger_wallet_test',
    DB_POOL_MAX: '50',
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
  });
}
