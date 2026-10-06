import crypto from 'crypto';

/** 10-digit account number, not globally guaranteed unique; callers retry on the UNIQUE constraint. */
export function generateAccountNumber(): string {
  const n = crypto.randomInt(0, 1_000_000_0000);
  return n.toString().padStart(10, '0');
}
