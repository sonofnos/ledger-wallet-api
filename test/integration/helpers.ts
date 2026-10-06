import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { getPool, resetPool } from '../../src/db/pool';
import { runMigrations } from '../../scripts/migrate';

let migrated = false;

// Close the pool before Jest tears down. Without this, the Testcontainers
// Postgres (stopped by global-teardown, in a separate process) can drop an
// idle pooled connection after this test file's run already finished,
// which logs an error through a console that Jest has already closed and
// gets misreported as a test failure ("Cannot log after tests are done").
afterAll(async () => {
  await resetPool();
});

/** Builds a fresh Express app. DB env vars are set by global-setup before any test file loads. */
export async function createTestApp(): Promise<Express> {
  await resetPool(); // picks up DB_HOST/DB_PORT from this test file's env, not a stale pool
  if (!migrated) {
    await runMigrations();
    migrated = true;
  }
  return createApp();
}

export async function resetState(): Promise<void> {
  const pool = getPool();
  await pool.query('TRUNCATE transactions, transfers, accounts, users CASCADE');
}

export function api(app: Express) {
  return request(app);
}

/** No deposit endpoint exists yet, so tests fund an account directly via SQL. */
export async function fundAccount(userId: string, amountCents: number): Promise<void> {
  await getPool().query(`UPDATE accounts SET balance_cents = $2 WHERE owner_id = $1`, [userId, amountCents]);
}

export async function getAccountRow(userId: string): Promise<{ id: string; accountNumber: string; balanceCents: number }> {
  const { rows } = await getPool().query<{ id: string; account_number: string; balance_cents: string }>(
    `SELECT id, account_number, balance_cents FROM accounts WHERE owner_id = $1`,
    [userId],
  );
  const row = rows[0];
  return { id: row.id, accountNumber: row.account_number, balanceCents: Number(row.balance_cents) };
}

export async function registerUser(app: Express, overrides: Partial<{ email: string; password: string; fullName: string }> = {}) {
  const body = {
    email: overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: overrides.password ?? 'Password123!',
    fullName: overrides.fullName ?? 'Test User',
  };
  const res = await api(app).post('/auth/register').send(body).expect(201);
  return { ...res.body, password: body.password } as { token: string; user: { id: string; email: string; fullName: string }; password: string };
}
