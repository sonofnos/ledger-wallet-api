import { Express } from 'express';
import { api, createTestApp, resetState } from './helpers';

describe('Auth', () => {
  let app: Express;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetState();
  });

  it('registers a new user and returns a token + user shape matching the contract', async () => {
    const res = await api(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: 'Password123!', fullName: 'Alice Example' })
      .expect(201);

    expect(res.body).toMatchObject({
      token: expect.any(String),
      user: { email: 'alice@example.com', fullName: 'Alice Example', id: expect.any(String) },
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it('rejects registration with a weak password', async () => {
    const res = await api(app)
      .post('/auth/register')
      .send({ email: 'bob@example.com', password: 'short', fullName: 'Bob' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects duplicate email registration', async () => {
    await api(app)
      .post('/auth/register')
      .send({ email: 'dupe@example.com', password: 'Password123!', fullName: 'A' })
      .expect(201);
    const res = await api(app)
      .post('/auth/register')
      .send({ email: 'dupe@example.com', password: 'Password123!', fullName: 'B' })
      .expect(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('logs in with correct credentials', async () => {
    await api(app)
      .post('/auth/register')
      .send({ email: 'carol@example.com', password: 'Password123!', fullName: 'Carol' })
      .expect(201);

    const res = await api(app)
      .post('/auth/login')
      .send({ email: 'carol@example.com', password: 'Password123!' })
      .expect(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('carol@example.com');
  });

  it('rejects login with wrong password with 401', async () => {
    await api(app)
      .post('/auth/register')
      .send({ email: 'dave@example.com', password: 'Password123!', fullName: 'Dave' })
      .expect(201);

    const res = await api(app)
      .post('/auth/login')
      .send({ email: 'dave@example.com', password: 'WrongPassword!' })
      .expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects login for unknown email with 401 (not a 404 that would leak account existence)', async () => {
    await api(app).post('/auth/login').send({ email: 'ghost@example.com', password: 'whatever123' }).expect(401);
  });
});
