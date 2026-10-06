import { requestHash } from '../../src/lib/hash';

describe('requestHash', () => {
  it('is deterministic for the same payload', () => {
    const payload = { fromAccountId: 'a', toAccountNumber: '123', amountCents: 500 };
    expect(requestHash(payload)).toBe(requestHash({ ...payload }));
  });

  it('differs when any field changes', () => {
    const base = { fromAccountId: 'a', toAccountNumber: '123', amountCents: 500 };
    expect(requestHash(base)).not.toBe(requestHash({ ...base, amountCents: 501 }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, toAccountNumber: '124' }));
  });
});
