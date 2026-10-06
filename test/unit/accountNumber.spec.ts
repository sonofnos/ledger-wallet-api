import { generateAccountNumber } from '../../src/lib/accountNumber';

describe('generateAccountNumber', () => {
  it('always returns a 10-digit numeric string', () => {
    for (let i = 0; i < 50; i++) {
      const n = generateAccountNumber();
      expect(n).toMatch(/^\d{10}$/);
    }
  });
});
