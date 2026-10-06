# ledger-wallet-api

A small, real REST API backend for a mobile wallet app: email/password auth, one account per user,
a transaction feed, and money transfers between accounts that are idempotent and safe under
concurrency. Built as the actual API behind a React Native/Expo wallet app
(`ledger-wallet-rn`), not a mock. Real Postgres, real password hashing, real row-locking,
and tests that exercise real concurrent connections against a real database.

## Stack

- Node.js + TypeScript + Express
- PostgreSQL via `pg` (plain parameterized SQL, no ORM)
- bcrypt for password hashing, JWT for auth
- zod for request validation
- Jest + Supertest for tests; Testcontainers spins up a real throwaway Postgres for integration tests

## API contract

All request/response bodies are JSON. Authenticated routes expect `Authorization: Bearer <token>`.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/register` | none | `{email, password, fullName}` | `201 {token, user: {id, email, fullName}}` |
| POST | `/auth/login` | none | `{email, password}` | `200 {token, user}`; `401` on bad credentials |
| GET | `/accounts/me` | required | none | `200 {id, ownerId, balanceCents, currency, accountNumber}` |
| GET | `/transactions` | required | query: `?limit=&cursor=` | `200 {items: [{id, type, amountCents, counterparty, status, createdAt}], nextCursor}` |
| POST | `/transfers` | required | `{toAccountNumber, amountCents, idempotencyKey}` | `201 {id, status: "completed"\|"failed"}` |
| GET | `/health` | none | none | `200 {status: "ok"}` |

Validation errors are `400 {error: {code: "validation_failed", message, details}}`. Other errors
follow the same `{error: {code, message}}` shape (`401 unauthorized`, `404 not_found`,
`409 email_taken` / `409 idempotency_key_reused`, `500 internal_error`).

### Deliberate choices not spelled out in the spec

- **Insufficient balance and an unknown destination account number are not HTTP errors.** They come
  back as `201 {id, status: "failed"}`, the same shape as a successful transfer, with a server-side
  `failure_reason` recorded (not currently exposed in the response body, but present in the DB row).
  This matches the spec's own response shape (`status: "completed"|"failed"`) and means the mobile
  client has one code path for "the transfer request was accepted and processed" instead of having
  to special-case a 4xx.
- **Idempotency key is global, not scoped to an account.** A client-generated UUID per transfer
  attempt is enough; nothing requires scoping it further for this API's purposes.
  Reusing a key with *different* transfer parameters is rejected with `409 idempotency_key_reused`
  instead of silently replaying the first result. Silently ignoring a parameter mismatch would hide
  a real client bug.
- **A transfer to an account's own account number** fails with `cannot_transfer_to_own_account`.
  Not in the original spec, but an obvious gap.
- **Pagination cursor** is an opaque base64url-encoded `{createdAt, id}`, not a raw offset. Stable
  under concurrent inserts, which an offset isn't.
- **Every registered user gets exactly one USD account automatically** at registration. The spec's
  `GET /accounts/me` implies single-account-per-user; there's no multi-account or multi-currency
  concept here.

## Running locally

```bash
cp .env.example .env
docker compose up -d        # Postgres on localhost:5443 (not 5432, to avoid clashing with other local projects)
npm install
npm run migrate              # applies migrations/*.sql
npm run seed                 # creates the demo user, funds its account, seeds transaction history
npm run dev                  # http://localhost:3000
```

Demo login (seeded, idempotent, safe to re-run `npm run seed`):

```
email:    demo@ledgerwallet.app
password: Demo1234!
```

### Build & typecheck

```bash
npm run build
npm run typecheck
npm run lint
```

## Running tests

```bash
npm test                   # unit tests (pure logic: zod schemas, hashing, cursor encoding), no DB needed
npm run test:integration   # integration tests against a real Postgres via Testcontainers, needs Docker
npm run test:all
```

The integration suite needs nothing pre-installed beyond Docker: `test/integration/global-setup.ts`
starts a throwaway `postgres:16-alpine` container, points the app's DB config at it, and
`global-teardown.ts` stops it afterwards. It runs the same way on a laptop and in CI.

**Current result (run locally against Docker Desktop):**

- Unit tests: 19 passed, 0 failed (4 suites)
- Integration tests: 20 passed, 0 failed (5 suites), covering auth, accounts, transactions (pagination,
  per-user isolation), health, and transfers (happy path, unknown destination, insufficient balance,
  idempotent replay x3, idempotency-key reuse conflict, 20 concurrent transfers racing the same
  sender balance, and two accounts transferring to each other in both directions concurrently)

I ran both suites myself with `npm test` and `npm run test:integration`. The counts above are
copy-pasted from that actual run, not estimated.

### The concurrency test, specifically

`test/integration/transfers.spec.ts` fires 20 concurrent `POST /transfers` requests from the same
sender account (balance 10,000, each transfer 700 cents) over 20 separate HTTP connections, so each
one gets its own connection out of the pool (`DB_POOL_MAX=50` in the test environment). This is a
real multi-connection race against Postgres row locks, not a single Node event-loop interleaving.
The assertion is `floor(10000 / 700) = 14` transfers complete and exactly `20 - 14 = 6` fail with
`insufficient_balance`, the sender's balance is never negative, and the total debited matches the
total credited to the receiver exactly. A second test runs 30 concurrent transfers in both directions
between the same two accounts to prove the lock ordering doesn't deadlock under a true bidirectional
race. See the bug below; this test is what caught the first version of the fix not actually working.

## How transfers are made safe

- **Idempotency**: `idempotencyKey` is claimed with `INSERT ... ON CONFLICT (idempotency_key) DO
  NOTHING`. A concurrent request with the same key blocks on the unique index until the first
  commits or rolls back, then sees the conflict directly. There's no read-then-write window where
  two requests could both decide "not claimed yet," which a `SELECT` followed by an `INSERT` would
  have.
- **Concurrency safety**: every account a transfer touches is locked with `SELECT ... FOR UPDATE`,
  always in ascending account-id order, before the transfer's balance is read or its claim row is
  inserted. See the bug below for why the order relative to the insert mattered, not just the lock
  itself. Fixed lock order also means two transfers moving money in opposite directions between the
  same pair of accounts can never deadlock on each other.

## Real bugs hit while building this

Both of these were caught by the concurrency integration tests actually failing, not
found by inspection. The first version of the code looked correct and passed every single-request
test. It only broke under genuine concurrent load.

1. **Deadlock on concurrent transfers from the same account (Postgres error `40P01`).** The first
   implementation locked both accounts with `SELECT ... FOR UPDATE` after inserting the `transfers`
   claim row. That claim row has a foreign key to `accounts.id` (`from_account_id`), and Postgres
   enforces FK constraints by implicitly taking a `FOR KEY SHARE` lock on the referenced row at
   `INSERT` time, before the code's own explicit lock ever runs. Under 20 concurrent transfers from
   one sender, every transaction's `INSERT` grabbed `KEY SHARE` on the sender's account row, and then
   every transaction tried to upgrade that to `FOR UPDATE` for the balance check. N transactions all
   waiting to upgrade a lock N others already hold is a real deadlock, not just contention. Postgres
   detected it and killed one side with `deadlock detected`. The fix: take the explicit `FOR UPDATE`
   lock on every touched account, in ascending id order, before inserting anything that has a
   foreign key into `accounts` (the transfers claim row, the transaction rows). Once the transaction
   already holds the strongest lock on a row, the later implicit FK check has nothing to upgrade.
   This is the same failure mode and fix documented in this workspace's `naira-rails` project
   (`lockAccounts` exists specifically for this reason). I didn't know to pre-empt it here until
   the test reproduced it.

2. **Unhandled `pg.Pool` `'error'` event crashing the process at the end of a test run.** After fixing
   the deadlock, the integration tests all passed but the process still exited with a non-zero code.
   The cause: Testcontainers stops the Postgres container in `global-teardown.ts`, and if the app's
   connection pool still has an idle client open at that moment, `pg` emits an `'error'` event on the
   `Pool` for that dropped connection. Node treats an `EventEmitter` `'error'` event with no listener
   as fatal and crashes the process. A well-known `node-postgres` gotcha, not a logic bug, but it
   would have looked exactly like "CI is flaky" without being understood. Fixed by attaching a
   `pool.on('error', ...)` listener that logs and swallows it (`src/db/pool.ts`), plus closing the
   pool explicitly in an `afterAll` in the test helpers so cleanup order is deterministic instead of
   racing the container shutdown.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests: `npm ci`, lint,
typecheck, build, unit tests, then integration tests. There's no Postgres `services:` block. The
integration job starts its own Testcontainers Postgres using the runner's Docker daemon, the same way
the local run does.

## Project layout

```
src/
  app.ts, server.ts        Express app wiring, HTTP entrypoint
  config.ts                 env var loading
  db/                        pg Pool singleton + transaction helper
  lib/                       jwt, hashing, cursor encoding, account number generation, errors
  middleware/                auth (Bearer JWT), error handler
  modules/
    auth/                     register, login
    accounts/                 GET /accounts/me
    transactions/             GET /transactions (cursor pagination)
    transfers/                POST /transfers (idempotent, concurrency-safe)
  routes/health.ts
migrations/                  forward-only SQL migrations, applied by scripts/migrate.ts
scripts/seed.ts               demo user + funded account + transaction history
test/unit/                    pure-logic tests, no DB
test/integration/              Testcontainers Postgres + Supertest against the real Express app
```

## Known limitations (deliberately out of scope for this pass)

- No refresh tokens or token revocation. A single long-lived JWT (`JWT_EXPIRES_IN`, default 7d).
- No rate limiting on `/auth/login`.
- `balance_cents` / `amount_cents` are Postgres `BIGINT` but handled as JS `number` in the app layer.
  Fine well within `Number.MAX_SAFE_INTEGER`, but a real money ledger at scale would want to keep
  amounts as `bigint` end-to-end the way `naira-rails` in this workspace does.
- Account number collisions are handled by retrying on the unique constraint rather than reserving a
  range up front. Fine at 10 digits of entropy for a demo, not how a real bank account numbering
  scheme would work.
