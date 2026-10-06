import { getPool } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

export interface AccountView {
  id: string;
  ownerId: string;
  balanceCents: number;
  currency: string;
  accountNumber: string;
}

interface AccountRow {
  id: string;
  owner_id: string;
  balance_cents: string;
  currency: string;
  account_number: string;
}

function toView(row: AccountRow): AccountView {
  return {
    id: row.id,
    ownerId: row.owner_id,
    balanceCents: Number(row.balance_cents),
    currency: row.currency,
    accountNumber: row.account_number,
  };
}

export async function getAccountForOwner(ownerId: string): Promise<AccountView> {
  const { rows } = await getPool().query<AccountRow>(
    `SELECT id, owner_id, balance_cents, currency, account_number FROM accounts WHERE owner_id = $1`,
    [ownerId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Account not found for this user');
  return toView(row);
}
