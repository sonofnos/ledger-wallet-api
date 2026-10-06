import { PoolClient } from 'pg';
import { withTransaction } from '../../db/tx';
import { ConflictError } from '../../lib/errors';
import { requestHash } from '../../lib/hash';
import { CreateTransferInput } from './schemas';

export interface TransferResult {
  id: string;
  status: 'completed' | 'failed';
}

interface AccountLockRow {
  id: string;
  balance_cents: string;
  account_number: string;
}

/**
 * Creates (or replays) a transfer.
 *
 * Idempotency: the idempotency_key is claimed with
 * `INSERT ... ON CONFLICT DO NOTHING`. A concurrent request with the same
 * key blocks on the unique index until the first commits, then sees the
 * conflict directly. There is no read-then-write window where two
 * requests could both decide "not claimed yet".
 *
 * Concurrency safety: every account touched by the transfer is locked with
 * `SELECT ... FOR UPDATE`, always in ascending id order, BEFORE anything
 * else in the transaction references that account's row, including the
 * transfers claim insert itself, see the note on lock order below.
 */
export async function createTransfer(fromAccountId: string, input: CreateTransferInput): Promise<TransferResult> {
  const hash = requestHash({
    fromAccountId,
    toAccountNumber: input.toAccountNumber,
    amountCents: input.amountCents,
  });

  return withTransaction(async (client) => {
    // Cheap idempotency check first: a pure replay never needs to lock
    // anything. (The authoritative check is still the unique index below;
    // this just avoids taking locks for the common replay case.)
    const existing = await client.query<{ id: string; request_hash: string; status: string }>(
      `SELECT id, request_hash, status FROM transfers WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return resolveReplay(existing.rows[0], hash, input.idempotencyKey);
    }

    const destLookup = await client.query<{ id: string }>(`SELECT id FROM accounts WHERE account_number = $1`, [
      input.toAccountNumber,
    ]);
    const toAccountId = destLookup.rows[0]?.id;

    // Lock every account this transfer touches, in a fixed ascending-id
    // order, BEFORE inserting the transfers claim row below.
    //
    // Real bug hit while writing the concurrency test: the transfers table
    // has a FK on from_account_id. Postgres enforces that FK by taking a
    // FOR KEY SHARE lock on the referenced accounts row at INSERT time,
    // implicitly, before our code gets to run its own FOR UPDATE. Under 20
    // concurrent transfers from the same sender, each transaction's INSERT
    // grabbed KEY SHARE on the sender row, then each one asked to upgrade
    // to FOR UPDATE for the balance check. N transactions all waiting to
    // upgrade a lock N others already hold produces a real Postgres
    // deadlock (error 40P01), not just contention. Taking the FOR UPDATE
    // explicitly first means our own transaction already holds the
    // strongest lock before the FK check ever runs, so there is no
    // lock to upgrade.
    const idsToLock = toAccountId ? [fromAccountId, toAccountId].sort() : [fromAccountId];
    const { rows: locked } = await client.query<AccountLockRow>(
      `SELECT id, balance_cents, account_number FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [idsToLock],
    );
    const byId = new Map(locked.map((r) => [r.id, r]));

    const claim = await client.query<{ id: string }>(
      `INSERT INTO transfers (idempotency_key, request_hash, from_account_id, to_account_number, amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.idempotencyKey, hash, fromAccountId, input.toAccountNumber, input.amountCents],
    );

    if (claim.rowCount === 0) {
      // Another transaction claimed this exact key while we were locking
      // accounts (e.g. a true replay fired concurrently with the original).
      const race = await client.query<{ id: string; request_hash: string; status: string }>(
        `SELECT id, request_hash, status FROM transfers WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      return resolveReplay(race.rows[0], hash, input.idempotencyKey);
    }

    const transferId = claim.rows[0].id;

    if (!toAccountId) {
      return fail(client, transferId, 'destination_account_not_found');
    }
    if (toAccountId === fromAccountId) {
      return fail(client, transferId, 'cannot_transfer_to_own_account');
    }

    const from = byId.get(fromAccountId)!;
    const to = byId.get(toAccountId)!;
    const fromBalance = BigInt(from.balance_cents);
    const amount = BigInt(input.amountCents);
    if (fromBalance < amount) {
      return fail(client, transferId, 'insufficient_balance');
    }

    await client.query(`UPDATE accounts SET balance_cents = balance_cents - $2 WHERE id = $1`, [
      fromAccountId,
      input.amountCents,
    ]);
    await client.query(`UPDATE accounts SET balance_cents = balance_cents + $2 WHERE id = $1`, [
      toAccountId,
      input.amountCents,
    ]);

    await client.query(
      `INSERT INTO transactions (account_id, type, amount_cents, counterparty, status, transfer_id)
       VALUES ($1, 'debit', $2, $3, 'completed', $4), ($5, 'credit', $2, $6, 'completed', $4)`,
      [fromAccountId, input.amountCents, to.account_number, transferId, toAccountId, from.account_number],
    );

    await client.query(`UPDATE transfers SET status = 'completed', to_account_id = $2 WHERE id = $1`, [
      transferId,
      toAccountId,
    ]);

    return { id: transferId, status: 'completed' };
  });
}

function resolveReplay(
  existing: { id: string; request_hash: string; status: string } | undefined,
  hash: string,
  idempotencyKey: string,
): TransferResult {
  if (!existing) {
    throw new Error('Transfer conflict but no existing row found');
  }
  if (existing.request_hash !== hash) {
    throw new ConflictError(
      `Idempotency key ${idempotencyKey} was already used with different transfer parameters`,
      'idempotency_key_reused',
    );
  }
  return { id: existing.id, status: existing.status as 'completed' | 'failed' };
}

async function fail(client: PoolClient, transferId: string, reason: string): Promise<TransferResult> {
  await client.query(`UPDATE transfers SET status = 'failed', failure_reason = $2 WHERE id = $1`, [
    transferId,
    reason,
  ]);
  return { id: transferId, status: 'failed' };
}
