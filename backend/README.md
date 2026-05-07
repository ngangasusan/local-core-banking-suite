# Corebank backend — Express + MySQL

This is the new backend that replaces the Supabase/Postgres stack. It runs as a normal Node process; the Lovable preview cannot host it.

## Local setup

1. Install MySQL 8 (or use Docker: `docker run -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=corebank -p 3306:3306 -d mysql:8`).
2. `cd backend && cp .env.example .env`, fill in `MYSQL_URL`, `JWT_SECRET`, `PII_KEY`.
   - `JWT_SECRET`: `openssl rand -hex 64`
   - `PII_KEY`:    `openssl rand -hex 32`
3. `bun install`
4. `bun run migrate`     ← creates schema + seeds chart of accounts
5. `bun run dev`         ← API on `http://localhost:8080`
6. Bootstrap the first super_admin:
   ```bash
   curl -X POST http://localhost:8080/auth/bootstrap \
     -H "content-type: application/json" \
     -d '{"email":"you@example.com","password":"changeme123","full_name":"You"}'
   ```

## Auth flow

| Endpoint | Purpose |
|---|---|
| `POST /auth/bootstrap` | One-time: create the first super_admin (only works when `users` is empty). |
| `POST /auth/login` | Returns access token (15 min) + sets `rt` httpOnly refresh cookie. If MFA enrolled, returns `{ mfa_required: true, pre_auth_token }` instead. |
| `POST /auth/mfa/verify` | Body `{ code }`, requires `Authorization: Bearer <pre_auth_token>`. Issues real session. |
| `POST /auth/mfa/enroll/start` | Returns `{ secret, otpauth_url, qr_code }`. |
| `POST /auth/mfa/enroll/finish` | Body `{ code }`. Marks user as MFA-enrolled. |
| `POST /auth/refresh` | Reads `rt` cookie, rotates, returns new access token. |
| `POST /auth/logout` | Revokes refresh token. |
| `GET /auth/me` | Current user + roles. |
| `POST /auth/users` | Admin-only: create new user with role. |

Privileged actions (write-off approval, repayment reversal, COA edits) require **both** the admin role **and** `req.user.mfa === true` — meaning the session must have been started via `/auth/mfa/verify`.

## Migrating existing data

Once the new MySQL is up:

```bash
SUPABASE_PG_URL='postgres://postgres:...' bun run migrate:from-supabase
```

This copies customers, accounts, loans, repayments, journal entries, collections, etc. **All imported users get a placeholder password and must reset on first login.** PII vault and `audit_log` are not copied — the new system rebuilds the vault on first write and starts a fresh audit chain.
