import bcrypt from 'bcrypt';
import { getPool } from '../src/db/pool';
import { generateAccountNumber } from '../src/lib/accountNumber';
import { runMigrations } from './migrate';

const DEMO_EMAIL = 'demo@ledgerwallet.app';
const DEMO_PASSWORD = 'Demo1234!';

/**
 * Idempotent seed: safe to run repeatedly against the same database. If the
 * demo user already exists, it's left alone rather than re-seeded.
 */
export async function seed(): Promise<void> {
  await runMigrations();
  const pool = getPool();

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL]);
  if (existing.rows[0]) {
    console.log('Demo user already exists, skipping seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [DEMO_EMAIL, passwordHash, 'Demo User'],
    );
    const userId = userResult.rows[0].id;

    const accountNumber = generateAccountNumber();
    const accountResult = await client.query<{ id: string }>(
      `INSERT INTO accounts (owner_id, balance_cents, currency, account_number)
       VALUES ($1, 250000, 'USD', $2) RETURNING id`,
      [userId, accountNumber],
    );
    const accountId = accountResult.rows[0].id;

    const history: Array<{ type: 'credit' | 'debit'; amount: number; counterparty: string; daysAgo: number }> = [
      { type: 'credit', amount: 300000, counterparty: 'Payroll Inc', daysAgo: 10 },
      { type: 'debit', amount: 4500, counterparty: 'Coffee Shop', daysAgo: 8 },
      { type: 'debit', amount: 12000, counterparty: 'Grocery Mart', daysAgo: 6 },
      { type: 'credit', amount: 5000, counterparty: 'Jane Doe', daysAgo: 4 },
      { type: 'debit', amount: 38500, counterparty: 'Electric Co', daysAgo: 2 },
    ];

    for (const h of history) {
      await client.query(
        `INSERT INTO transactions (account_id, type, amount_cents, counterparty, status, created_at)
         VALUES ($1, $2, $3, $4, 'completed', now() - $5::interval)`,
        [accountId, h.type, h.amount, h.counterparty, `${h.daysAgo} days`],
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded demo user ${DEMO_EMAIL} / account ${accountNumber} with balance 250000 cents.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
