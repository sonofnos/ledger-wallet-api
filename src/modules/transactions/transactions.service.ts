import { getPool } from '../../db/pool';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { ValidationError } from '../../lib/errors';

export interface TransactionView {
  id: string;
  type: 'credit' | 'debit';
  amountCents: number;
  counterparty: string;
  status: string;
  createdAt: string;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
}

interface TransactionRow {
  id: string;
  type: 'credit' | 'debit';
  amount_cents: string;
  counterparty: string;
  status: string;
  created_at: Date;
}

function toView(row: TransactionRow): TransactionView {
  return {
    id: row.id,
    type: row.type,
    amountCents: Number(row.amount_cents),
    counterparty: row.counterparty,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listTransactions(
  accountId: string,
  limit: number,
  cursorRaw?: string,
): Promise<TransactionPage> {
  const cursor = cursorRaw ? decodeCursor(cursorRaw) : undefined;
  if (cursorRaw && !cursor) {
    throw new ValidationError('Invalid cursor');
  }

  const params: unknown[] = [accountId];
  let where = 'account_id = $1';
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    where += ` AND (created_at, id) < ($2, $3)`;
  }
  params.push(limit + 1);
  const limitParamIndex = params.length;

  const { rows } = await getPool().query<TransactionRow>(
    `SELECT id, type, amount_cents, counterparty, status, created_at
       FROM transactions
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParamIndex}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(toView);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;

  return { items, nextCursor };
}
