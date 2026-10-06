import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  db: {
    host: required('DB_HOST', 'localhost'),
    port: parseInt(process.env.DB_PORT ?? '5443', 10),
    user: required('DB_USER', 'ledger'),
    password: required('DB_PASSWORD', 'ledger'),
    database: required('DB_NAME', 'ledger_wallet'),
    poolMax: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
  },
  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
};
