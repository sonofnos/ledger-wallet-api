CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES users(id),
  balance_cents  BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency       TEXT NOT NULL DEFAULT 'USD',
  account_number TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_owner_id ON accounts(owner_id);

CREATE TABLE transfers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   TEXT NOT NULL UNIQUE,
  request_hash      TEXT NOT NULL,
  from_account_id    UUID NOT NULL REFERENCES accounts(id),
  to_account_number TEXT NOT NULL,
  to_account_id     UUID REFERENCES accounts(id),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  status            TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id),
  type         TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  counterparty TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'completed',
  transfer_id  UUID REFERENCES transfers(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_account_id_created_at ON transactions(account_id, created_at DESC, id DESC);
