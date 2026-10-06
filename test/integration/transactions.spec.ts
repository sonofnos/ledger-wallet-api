import { Express } from 'express';
import { getPool } from '../../src/db/pool';
import { api, createTestApp, getAccountRow, registerUser, resetState } from './helpers';

describe('GET /transactions', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
  });

  async function seedTransactions(accountId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await getPool().query(
        `INSERT INTO transactions (account_id, type, amount_cents, counterparty, status, created_at)
         VALUES ($1, 'credit', $2, $3, 'completed', now() - ($4 || ' seconds')::interval)`,
        [accountId, 100 + i, `payer-${i}`, n - i],
      );
    }
  }

  it('returns items in the contract shape, newest first', async () => {
    const { token, user } = await registerUser(app);
    const account = await getAccountRow(user.id);
    await seedTransactions(account.id, 3);

    const res = await api(app).get('/transactions').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      id: expect.any(String),
      type: 'credit',
      amountCents: expect.any(Number),
      counterparty: expect.any(String),
      status: 'completed',
      createdAt: expect.any(String),
    });
    // newest first: the last-seeded row (highest amount, most recent) comes first
    expect(res.body.items[0].amountCents).toBe(102);
    expect(res.body.items[2].amountCents).toBe(100);
  });

  it('paginates with limit and cursor without skipping or repeating rows', async () => {
    const { token, user } = await registerUser(app);
    const account = await getAccountRow(user.id);
    await seedTransactions(account.id, 5);

    const page1 = await api(app)
      .get('/transactions')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await api(app)
      .get('/transactions')
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(2);

    const page3 = await api(app)
      .get('/transactions')
      .query({ limit: 2, cursor: page2.body.nextCursor })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.nextCursor).toBeNull();

    const allIds = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((t: any) => t.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('only returns transactions for the authenticated user own account', async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const accountA = await getAccountRow(userA.user.id);
    await seedTransactions(accountA.id, 2);

    const res = await api(app).get('/transactions').set('Authorization', `Bearer ${userB.token}`).expect(200);
    expect(res.body.items).toHaveLength(0);
  });
});
