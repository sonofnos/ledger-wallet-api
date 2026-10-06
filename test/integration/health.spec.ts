import { Express } from 'express';
import { api, createTestApp } from './helpers';

describe('GET /health', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
  });

  it('returns ok', async () => {
    const res = await api(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
