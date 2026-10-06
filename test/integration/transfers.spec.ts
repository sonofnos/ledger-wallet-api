import { randomUUID } from 'crypto';
import { Express } from 'express';
import { getPool } from '../../src/db/pool';
import { api, createTestApp, fundAccount, getAccountRow, registerUser, resetState } from './helpers';

describe('POST /transfers', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
  });

  it('moves money between two accounts and records both sides as transactions', async () => {
    const sender = await registerUser(app);
    const receiver = await registerUser(app);
    await fundAccount(sender.user.id, 10_000);
    const receiverAccount = await getAccountRow(receiver.user.id);

    const res = await api(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ toAccountNumber: receiverAccount.accountNumber, amountCents: 2_500, idempotencyKey: randomUUID() })
      .expect(201);

    expect(res.body).toMatchObject({ id: expect.any(String), status: 'completed' });

    const senderAccount = await getAccountRow(sender.user.id);
    const receiverAfter = await getAccountRow(receiver.user.id);
    expect(senderAccount.balanceCents).toBe(7_500);
    expect(receiverAfter.balanceCents).toBe(2_500);

    const senderTx = await api(app).get('/transactions').set('Authorization', `Bearer ${sender.token}`).expect(200);
    expect(senderTx.body.items[0]).toMatchObject({ type: 'debit', amountCents: 2_500, status: 'completed' });

    const receiverTx = await api(app)
      .get('/transactions')
      .set('Authorization', `Bearer ${receiver.token}`)
      .expect(200);
    expect(receiverTx.body.items[0]).toMatchObject({ type: 'credit', amountCents: 2_500, status: 'completed' });
  });

  it('rejects a transfer to a nonexistent account number as a failed transfer, not a 400', async () => {
    const sender = await registerUser(app);
    await fundAccount(sender.user.id, 10_000);

    const res = await api(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ toAccountNumber: '0000000000', amountCents: 100, idempotencyKey: randomUUID() })
      .expect(201);
    expect(res.body.status).toBe('failed');

    const senderAccount = await getAccountRow(sender.user.id);
    expect(senderAccount.balanceCents).toBe(10_000); // untouched
  });

  it('rejects insufficient balance as a failed transfer and leaves balances untouched', async () => {
    const sender = await registerUser(app);
    const receiver = await registerUser(app);
    await fundAccount(sender.user.id, 500);
    const receiverAccount = await getAccountRow(receiver.user.id);

    const res = await api(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ toAccountNumber: receiverAccount.accountNumber, amountCents: 10_000, idempotencyKey: randomUUID() })
      .expect(201);
    expect(res.body.status).toBe('failed');

    const senderAccount = await getAccountRow(sender.user.id);
    const receiverAfter = await getAccountRow(receiver.user.id);
    expect(senderAccount.balanceCents).toBe(500);
    expect(receiverAfter.balanceCents).toBe(0);
  });

  it('is idempotent: replaying the same idempotency key does not double-transfer', async () => {
    const sender = await registerUser(app);
    const receiver = await registerUser(app);
    await fundAccount(sender.user.id, 10_000);
    const receiverAccount = await getAccountRow(receiver.user.id);
    const idempotencyKey = randomUUID();
    const body = { toAccountNumber: receiverAccount.accountNumber, amountCents: 3_000, idempotencyKey };

    const first = await api(app).post('/transfers').set('Authorization', `Bearer ${sender.token}`).send(body).expect(201);
    const second = await api(app).post('/transfers').set('Authorization', `Bearer ${sender.token}`).send(body).expect(201);
    const third = await api(app).post('/transfers').set('Authorization', `Bearer ${sender.token}`).send(body).expect(201);

    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);

    const senderAccount = await getAccountRow(sender.user.id);
    expect(senderAccount.balanceCents).toBe(7_000); // debited exactly once, not three times
  });

  it('rejects reusing an idempotency key with different transfer parameters', async () => {
    const sender = await registerUser(app);
    const receiver = await registerUser(app);
    await fundAccount(sender.user.id, 10_000);
    const receiverAccount = await getAccountRow(receiver.user.id);
    const idempotencyKey = randomUUID();

    await api(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ toAccountNumber: receiverAccount.accountNumber, amountCents: 1_000, idempotencyKey })
      .expect(201);

    const res = await api(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ toAccountNumber: receiverAccount.accountNumber, amountCents: 2_000, idempotencyKey })
      .expect(409);
    expect(res.body.error.code).toBe('idempotency_key_reused');
  });

  it(
    'handles concurrent transfers from the same account safely: never overdraws, exactly the affordable ' +
      'number succeed, and the loser transfers are recorded as failed (not lost or double-applied)',
    async () => {
      const sender = await registerUser(app);
      const receiver = await registerUser(app);
      await fundAccount(sender.user.id, 10_000);
      const receiverAccount = await getAccountRow(receiver.user.id);

      // 20 concurrent transfers of 700 each from a 10,000 balance: only 14
      // can succeed (14 * 700 = 9800, 15 * 700 = 10500 > balance). Each
      // request hits the server over its own HTTP connection and the server
      // pulls its own client out of a 50-connection pool, so this is a real
      // multi-connection race against Postgres row locks, not a single
      // in-process mutex.
      const amount = 700;
      const count = 20;
      const requests = Array.from({ length: count }, () =>
        api(app)
          .post('/transfers')
          .set('Authorization', `Bearer ${sender.token}`)
          .send({ toAccountNumber: receiverAccount.accountNumber, amountCents: amount, idempotencyKey: randomUUID() }),
      );

      const results = await Promise.all(requests);
      const completed = results.filter((r) => r.body.status === 'completed');
      const failed = results.filter((r) => r.body.status === 'failed');

      expect(completed.length).toBe(14); // floor(10000 / 700)
      expect(failed.length).toBe(count - completed.length);

      const senderAccount = await getAccountRow(sender.user.id);
      const receiverAfter = await getAccountRow(receiver.user.id);
      expect(senderAccount.balanceCents).toBe(10_000 - 14 * amount);
      expect(senderAccount.balanceCents).toBeGreaterThanOrEqual(0); // never overdrawn
      expect(receiverAfter.balanceCents).toBe(14 * amount);

      // Books balance: total debited from sender equals total credited to receiver.
      const { rows } = await getPool().query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE account_id = $1 AND type = 'debit'`,
        [senderAccount.id],
      );
      expect(Number(rows[0].total)).toBe(14 * amount);
    },
    30000,
  );

  it('two accounts transferring to each other concurrently in both directions do not deadlock', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await fundAccount(a.user.id, 100_000);
    await fundAccount(b.user.id, 100_000);
    const aAccount = await getAccountRow(a.user.id);
    const bAccount = await getAccountRow(b.user.id);

    const requests = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0
        ? api(app)
            .post('/transfers')
            .set('Authorization', `Bearer ${a.token}`)
            .send({ toAccountNumber: bAccount.accountNumber, amountCents: 100, idempotencyKey: randomUUID() })
        : api(app)
            .post('/transfers')
            .set('Authorization', `Bearer ${b.token}`)
            .send({ toAccountNumber: aAccount.accountNumber, amountCents: 50, idempotencyKey: randomUUID() }),
    );

    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.every((r) => r.body.status === 'completed')).toBe(true);

    const aAfter = await getAccountRow(a.user.id);
    const bAfter = await getAccountRow(b.user.id);
    expect(aAfter.balanceCents).toBe(100_000 - 15 * 100 + 15 * 50);
    expect(bAfter.balanceCents).toBe(100_000 - 15 * 50 + 15 * 100);
  }, 30000);
});
