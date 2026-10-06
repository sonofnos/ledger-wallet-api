import { decodeCursor, encodeCursor } from '../../src/lib/cursor';

describe('cursor encode/decode', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2024-01-01T00:00:00.000Z', id: 'abc-123' };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('returns undefined for garbage input instead of throwing', () => {
    expect(decodeCursor('not-valid-base64url-json')).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });
});
