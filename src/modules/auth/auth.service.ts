import bcrypt from 'bcrypt';
import { PoolClient } from 'pg';
import { getPool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { ConflictError, UnauthorizedError } from '../../lib/errors';
import { signToken } from '../../lib/jwt';
import { generateAccountNumber } from '../../lib/accountNumber';
import { LoginInput, RegisterInput } from './schemas';

const BCRYPT_ROUNDS = 10;

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

async function createAccountForUser(client: PoolClient, userId: string): Promise<void> {
  // Account numbers are generated client-side and only checked for
  // uniqueness at insert time; retry a handful of times on collision
  // rather than taking a lock up front (collisions are rare at 10 digits).
  for (let attempt = 0; attempt < 5; attempt++) {
    const accountNumber = generateAccountNumber();
    try {
      await client.query(
        `INSERT INTO accounts (owner_id, balance_cents, currency, account_number)
         VALUES ($1, 0, 'USD', $2)`,
        [userId, accountNumber],
      );
      return;
    } catch (err: any) {
      if (err?.code === '23505') continue; // unique_violation on account_number, retry
      throw err;
    }
  }
  throw new Error('Could not allocate a unique account number after 5 attempts');
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await withTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [input.email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictError('Email already registered', 'email_taken');
    }

    const inserted = await client.query<{ id: string; email: string; full_name: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)
       RETURNING id, email, full_name`,
      [input.email, passwordHash, input.fullName],
    );
    const row = inserted.rows[0];
    await createAccountForUser(client, row.id);
    return row;
  });

  const publicUser: PublicUser = { id: user.id, email: user.email, fullName: user.full_name };
  const token = signToken({ sub: user.id, email: user.email });
  return { token, user: publicUser };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; email: string; full_name: string; password_hash: string }>(
    'SELECT id, email, full_name, password_hash FROM users WHERE email = $1',
    [input.email],
  );
  const row = rows[0];
  if (!row) throw new UnauthorizedError();

  const valid = await bcrypt.compare(input.password, row.password_hash);
  if (!valid) throw new UnauthorizedError();

  const publicUser: PublicUser = { id: row.id, email: row.email, fullName: row.full_name };
  const token = signToken({ sub: row.id, email: row.email });
  return { token, user: publicUser };
}
