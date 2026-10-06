import crypto from 'crypto';

/** Stable hash of a request's semantic content, used to detect idempotency-key reuse with different params. */
export function requestHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
