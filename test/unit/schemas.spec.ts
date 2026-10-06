import { loginSchema, registerSchema } from '../../src/modules/auth/schemas';
import { listTransactionsQuerySchema } from '../../src/modules/transactions/schemas';
import { createTransferSchema } from '../../src/modules/transfers/schemas';

describe('registerSchema', () => {
  it('accepts a valid payload', () => {
    expect(() =>
      registerSchema.parse({ email: 'a@b.com', password: 'longenough', fullName: 'A B' }),
    ).not.toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => registerSchema.parse({ email: 'not-an-email', password: 'longenough', fullName: 'A' })).toThrow();
  });

  it('rejects a short password', () => {
    expect(() => registerSchema.parse({ email: 'a@b.com', password: 'short', fullName: 'A' })).toThrow();
  });

  it('rejects a missing fullName', () => {
    expect(() => registerSchema.parse({ email: 'a@b.com', password: 'longenough' })).toThrow();
  });
});

describe('loginSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => loginSchema.parse({ email: 'a@b.com', password: 'x' })).not.toThrow();
  });

  it('rejects an empty password', () => {
    expect(() => loginSchema.parse({ email: 'a@b.com', password: '' })).toThrow();
  });
});

describe('createTransferSchema', () => {
  it('accepts a valid payload', () => {
    expect(() =>
      createTransferSchema.parse({ toAccountNumber: '1234567890', amountCents: 100, idempotencyKey: 'k1' }),
    ).not.toThrow();
  });

  it('rejects a zero or negative amount', () => {
    expect(() =>
      createTransferSchema.parse({ toAccountNumber: '1234567890', amountCents: 0, idempotencyKey: 'k1' }),
    ).toThrow();
    expect(() =>
      createTransferSchema.parse({ toAccountNumber: '1234567890', amountCents: -5, idempotencyKey: 'k1' }),
    ).toThrow();
  });

  it('rejects a non-integer amount', () => {
    expect(() =>
      createTransferSchema.parse({ toAccountNumber: '1234567890', amountCents: 10.5, idempotencyKey: 'k1' }),
    ).toThrow();
  });

  it('rejects a missing idempotencyKey', () => {
    expect(() => createTransferSchema.parse({ toAccountNumber: '1234567890', amountCents: 100 })).toThrow();
  });
});

describe('listTransactionsQuerySchema', () => {
  it('defaults limit to 20', () => {
    expect(listTransactionsQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces a string limit to a number', () => {
    expect(listTransactionsQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });

  it('rejects a limit over 100', () => {
    expect(() => listTransactionsQuerySchema.parse({ limit: '101' })).toThrow();
  });

  it('rejects a limit of 0', () => {
    expect(() => listTransactionsQuerySchema.parse({ limit: '0' })).toThrow();
  });
});
