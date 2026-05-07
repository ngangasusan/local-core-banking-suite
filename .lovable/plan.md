
## Important reality check first

The Lovable sandbox runs **one** thing: the TanStack Start app on a Cloudflare-style Worker runtime. It cannot:

- run a long-lived Express server,
- run MySQL,
- run pg_cron, scheduled jobs, or background workers.

So as soon as we rip out Supabase, **the live preview will stop working for any data-driven page** (login, customers, loans, collections, dashboard, reports — everything). You'll need to run the new stack on your own machine (or a VPS / Render / Railway / Fly) to actually use the app. The Lovable editor will still let us write and version the code, but "open preview" will show empty/error states.

Also: a lot of the business logic currently lives in Postgres (RLS, triggers, RPCs like `apply_repayment`, `approve_loan_writeoff`, `recompute_credit_score`, encrypted PII vault, hash-chained audit log, ECL provisioning, M-Pesa charge tables, etc.). MySQL has no RLS, weaker triggers, no pgcrypto, no `gen_random_uuid()` semantics in older versions. **All of that logic must be rewritten in Node/TypeScript inside the Express backend.** This is several days of work, not a single sprint.

If you accept those tradeoffs, here's the plan.

---

## Target repo structure

```text
/  (repo root — keeps Lovable scaffolding so the editor still works)
├── frontend/                 ← React 19 SPA (Vite, no SSR, no TanStack Start)
│   ├── src/
│   │   ├── routes/           ← migrated from current src/routes (TanStack Router SPA mode)
│   │   ├── components/       ← copied as-is
│   │   ├── lib/api.ts        ← typed fetch client to backend
│   │   └── lib/auth.tsx      ← JWT-based, replaces Supabase auth
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                  ← Node 20 + Express 4 + TypeScript
│   ├── src/
│   │   ├── index.ts          ← bootstrap, cors, json, error handler
│   │   ├── db.ts             ← mysql2/promise pool
│   │   ├── env.ts            ← zod-validated env
│   │   ├── auth/
│   │   │   ├── jwt.ts        ← sign/verify access + refresh
│   │   │   ├── bcrypt.ts
│   │   │   ├── mfa.ts        ← otplib TOTP (replaces Supabase MFA)
│   │   │   └── middleware.ts ← requireAuth, requireRole, requireMfa
│   │   ├── services/         ← all ported pg logic
│   │   │   ├── loans.ts      ← apply_repayment waterfall, disbursement JE
│   │   │   ├── collections.ts← sweep_broken_promises, restructure, write-off
│   │   │   ├── credit.ts     ← recompute_credit_score, qualified_loan_amount
│   │   │   ├── provisions.ts ← recompute_loan_provisions (ECL)
│   │   │   ├── audit.ts      ← hash-chain audit log
│   │   │   ├── pii.ts        ← AES-256-GCM PII vault (replaces pgcrypto)
│   │   │   └── notifications.ts
│   │   ├── routes/           ← Express routers, one per resource
│   │   │   ├── auth.routes.ts
│   │   │   ├── customers.routes.ts
│   │   │   ├── loans.routes.ts
│   │   │   ├── repayments.routes.ts
│   │   │   ├── accounts.routes.ts
│   │   │   ├── collections.routes.ts
│   │   │   ├── reports.routes.ts
│   │   │   ├── audit.routes.ts
│   │   │   ├── users.routes.ts
│   │   │   └── kyc.routes.ts ← multer → local /uploads or S3
│   │   ├── jobs/             ← node-cron (replaces pg_cron)
│   │   │   ├── accrue-late-fees.ts
│   │   │   ├── mark-overdue.ts
│   │   │   ├── sweep-promises.ts
│   │   │   └── loan-reminders.ts
│   │   └── validation/       ← zod schemas per route
│   ├── migrations/           ← node-pg-migrate-style or umzug + raw SQL for MySQL 8
│   │   ├── 001_init.sql
│   │   ├── 002_indexes.sql
│   │   └── 003_seed_coa.sql
│   ├── scripts/
│   │   └── migrate-from-supabase.ts ← reads from Postgres, writes to MySQL
│   ├── uploads/              ← local KYC files (gitignored)
│   ├── .env.example
│   ├── tsconfig.json
│   └── package.json
│
├── package.json              ← root workspaces, "dev" runs both
└── README.md                 ← how to run locally + migrate data
```

The current top-level `src/`, `supabase/`, `wrangler.jsonc`, `vite.config.ts` etc. will be **deleted** once the split is done — they're TanStack/Cloudflare/Supabase artifacts that won't apply.

---

## Schema port (Postgres → MySQL 8)

| Postgres | MySQL 8 equivalent |
|---|---|
| `uuid` + `gen_random_uuid()` | `CHAR(36)` + app-generated `crypto.randomUUID()` (or `BINARY(16)`) |
| `numeric(p,s)` | `DECIMAL(p,s)` |
| `timestamptz` | `DATETIME(3)` stored UTC; app converts |
| `jsonb` | `JSON` |
| `bytea` | `VARBINARY` / `BLOB` |
| `ENUM` types (`loan_status`, `kyc_status`, `app_role`, etc.) | MySQL native `ENUM(...)` columns |
| RLS policies | **Removed**; enforced in Express middleware (`requireRole`, ownership checks) |
| Triggers (`apply_repayment`, `audit_trigger`, `enforce_loan_rules`, `post_disbursement_je`, `sync_customer_pii_vault`, `audit_chain_hash`) | Rewritten in service layer, wrapped in `BEGIN/COMMIT` transactions |
| RPCs (`approve_loan_writeoff`, `recompute_credit_score`, `qualified_loan_amount`, `loan_aging`, `portfolio_par_summary`, `sweep_broken_promises`, `verify_customer_kyc`, `recompute_loan_provisions`, `compute_*`) | TS functions in `services/` |
| Views (`collections_worklist`) | MySQL `VIEW` or computed query in service |
| `pgcrypto` PII encryption | Node `crypto.createCipheriv('aes-256-gcm', ...)` with key from `PII_KEY` env |
| `auth.users` + `auth.mfa_factors` | New `users` table (email, password_hash, mfa_secret, mfa_verified) |
| Storage bucket `kyc-documents` | `multer` → local `uploads/` dir (or S3 later) |

All FKs (which were missing in the Supabase schema) will be **added** in MySQL with `ON DELETE RESTRICT` for safety.

---

## Auth design (JWT + bcrypt + TOTP)

- `POST /auth/register` — admin-only after first-user bootstrap; `bcrypt.hash(password, 12)`.
- `POST /auth/login` — verify password, if MFA enabled return `{ mfa_required: true, mfa_token }`, else issue tokens.
- `POST /auth/mfa/verify` — verify 6-digit TOTP, issue tokens.
- `POST /auth/refresh` — rotate refresh token (httpOnly cookie, `SameSite=Strict`).
- `POST /auth/logout` — revoke refresh token (stored in `refresh_tokens` table for rotation/revocation).
- Access token: JWT, 15 min, `{ sub, roles[], mfa: true|false }`, signed with `JWT_SECRET` (HS256).
- Frontend stores access token in memory (Zustand), refresh handled via cookie.
- Privileged actions (write-offs, repayment reversals, COA edits) check `req.user.mfa === true` in middleware.

---

## Migration script

`backend/scripts/migrate-from-supabase.ts`:

1. Reads `SUPABASE_DB_URL` from env, connects with `pg`.
2. Reads `MYSQL_URL` from env, connects with `mysql2`.
3. For each table in dependency order (profiles → user_roles → customers → accounts → loans → loan_repayments → journal_entries → audit_log → ...), `SELECT *` from PG, batch-`INSERT` into MySQL (1000 rows/batch).
4. Maps:
   - `auth.users` rows → new `users` table with **placeholder password hash**; users get a "set new password" email on first login (one-time token).
   - `customer_pii_vault` rows: decrypts with current `pgcrypto` key, re-encrypts with new AES-GCM key.
   - `audit_log`: chain hashes are recomputed from scratch in the new system (the old chain becomes the "imported" baseline, kept in `audit_log_legacy`).
5. Verifies row counts and prints a report.

**Warning:** existing user passwords cannot be migrated (Supabase stores bcrypt with its own pepper). Every user must reset their password on first login — this is unavoidable.

---

## Suggested execution order (multiple PRs, not one)

1. **PR 1 — Skeleton (this sprint):**
   - Create `/backend` with Express + MySQL pool + zod env + health route.
   - Create `/frontend` shell (Vite SPA, copy components, stub auth).
   - Write `001_init.sql` with full MySQL schema (all 25 tables, enums, indexes, FKs).
   - Implement auth (register/login/refresh/MFA) end-to-end.
   - Root `package.json` workspace + `bun run dev` runs both.
2. **PR 2 — Core CRUD:** customers, accounts, loans, KYC upload, profiles, user_roles, permissions. Frontend pages wired up.
3. **PR 3 — Money logic:** repayment waterfall + double-entry posting + disbursement JE + reversal flow + audit hash chain. This is the highest-risk port; needs unit tests.
4. **PR 4 — Collections, restructures, write-offs, provisions, credit scoring** (port the Sprint 3 RPCs).
5. **PR 5 — Reports, ledger, reconciliation, notifications, cron jobs (`node-cron`).**
6. **PR 6 — Data migration script + cutover docs + delete Supabase/TanStack scaffolding.**

Each PR keeps the previous one runnable.

---

## What I need from you to start PR 1

1. Confirm the **realities** above (preview will be broken; user passwords need reset; ~1–2 weeks of work split across PRs).
2. Confirm you want me to start with **PR 1 (skeleton + auth)** now, leaving the existing Supabase code untouched alongside until PR 6 — OR delete Supabase scaffolding immediately (faster but the app is non-functional from minute one).
3. KYC files — local disk for now, or wire S3 from the start? (Local is simpler; S3 needs AWS keys.)

Reply "go PR 1, keep Supabase alongside" (or your preferred variant) and I'll start.
