import { Express } from 'express';
import { api, createTestApp, getAccountRow, registerUser, resetState } from './helpers';

describe('GET /accounts/me', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
  });

  it('returns the authenticated user own account with contract shape', async () => {
    const { token, user } = await registerUser(app);
    const accountRow = await getAccountRow(user.id);

    const res = await api(app).get('/accounts/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toEqual({
      id: accountRow.id,
      ownerId: user.id,
      balanceCents: 0,
      currency: 'USD',
      accountNumber: accountRow.accountNumber,
    });
  });

  it('rejects requests with no bearer token', async () => {
    await api(app).get('/accounts/me').expect(401);
  });

  it('rejects requests with an invalid token', async () => {
    await api(app).get('/accounts/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });
});
