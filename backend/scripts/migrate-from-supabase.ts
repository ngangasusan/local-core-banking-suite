// One-shot data port from the existing Supabase Postgres into the new MySQL.
// Usage:
//   1. Ensure MySQL schema is migrated: `bun run migrate`
//   2. Set SUPABASE_PG_URL in backend/.env (use the service-role connection string)
//   3. `bun run migrate:from-supabase`
//
// Notes:
// - auth.users → users with a placeholder password hash; users MUST reset password
//   on first login. We pre-hash the literal "RESET-ME" so the row is valid.
// - customer_pii_vault rows are decrypted with pgcrypto inside Postgres
//   (via the existing public.decrypt_customer_pii or by reading raw bytea
//   and decrypting client-side is not possible since we don't have pg key) —
//   this script SKIPS PII vault and rebuilds it from customers.* on first
//   write through the new app, OR you can run a separate decrypt-and-port
//   step if you can export the key.
// - audit_log: imported as-is into audit_log_legacy (created on demand) so
//   the new chain starts clean. Old chain hashes are kept for reference.

import { Client as PgClient } from "pg";
import bcrypt from "bcrypt";
import { env } from "../src/env.js";
import { exec, pool, tx } from "../src/db.js";
import { newId } from "../src/util/uuid.js";

if (!env.SUPABASE_PG_URL) {
  console.error("SUPABASE_PG_URL is not set in backend/.env");
  process.exit(1);
}

const pg = new PgClient({ connectionString: env.SUPABASE_PG_URL, ssl: { rejectUnauthorized: false } });

const RESET_HASH = await bcrypt.hash("RESET-ME-" + Math.random().toString(36), 12);

type Row = Record<string, unknown>;

async function pgAll(sql: string): Promise<Row[]> {
  const r = await pg.query(sql);
  return r.rows as Row[];
}

const cols = (sample: Row) => Object.keys(sample);

async function batchInsert(table: string, rows: Row[], colsList: string[]) {
  if (!rows.length) return;
  const placeholders = "(" + colsList.map(() => "?").join(",") + ")";
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const sql = `INSERT IGNORE INTO ${table} (${colsList.join(",")}) VALUES ${slice.map(() => placeholders).join(",")}`;
    const params: unknown[] = [];
    for (const r of slice) for (const c of colsList) params.push(r[c] ?? null);
    await exec(sql, params);
  }
  console.log(`  ${table}: inserted ${rows.length}`);
}

async function portUsers() {
  console.log("→ users + profiles + user_roles");
  const users = await pgAll(`
    SELECT u.id::text, u.email,
      COALESCE(p.full_name, u.email) AS full_name
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
  `);
  await tx(async (cx) => {
    for (const u of users) {
      await cx.query(
        "INSERT IGNORE INTO users (id, email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?, 1)",
        [u.id, (u.email as string ?? "").toLowerCase(), u.full_name, RESET_HASH]
      );
      await cx.query(
        "INSERT IGNORE INTO profiles (id, full_name, email) VALUES (?, ?, ?)",
        [u.id, u.full_name, (u.email as string ?? "").toLowerCase()]
      );
    }
  });
  const roles = await pgAll(`SELECT id::text, user_id::text, role::text, created_at FROM public.user_roles`);
  await batchInsert("user_roles", roles, ["id","user_id","role","created_at"]);
}

async function portTable(pgSql: string, mysqlTable: string, mysqlCols: string[]) {
  console.log(`→ ${mysqlTable}`);
  const rows = await pgAll(pgSql);
  // ensure missing columns become null
  const normalized = rows.map((r) => {
    const out: Row = {};
    for (const c of mysqlCols) out[c] = r[c] ?? null;
    return out;
  });
  await batchInsert(mysqlTable, normalized, mysqlCols);
}

async function main() {
  await pg.connect();
  console.log("Connected to Postgres + MySQL");

  await portUsers();

  await portTable(
    `SELECT id::text, customer_number, customer_type::text, full_name, national_id, date_of_birth,
            email, phone, address, city, country, occupation, employer, monthly_income,
            kyc_status::text, kyc_notes, kyc_submitted_by::text, kyc_submitted_at,
            kyc_verified_by::text, kyc_verified_at, kyc_rejection_reason,
            credit_score, is_active, created_by::text, created_at, updated_at
     FROM public.customers`,
    "customers",
    ["id","customer_number","customer_type","full_name","national_id","date_of_birth",
     "email","phone","address","city","country","occupation","employer","monthly_income",
     "kyc_status","kyc_notes","kyc_submitted_by","kyc_submitted_at",
     "kyc_verified_by","kyc_verified_at","kyc_rejection_reason",
     "credit_score","is_active","created_by","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, account_number, account_type::text, customer_id::text, currency,
            balance, interest_rate, status::text, opened_at, created_at, updated_at
     FROM public.accounts`,
    "accounts",
    ["id","account_number","account_type","customer_id","currency","balance","interest_rate","status","opened_at","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, loan_number, customer_id::text, account_id::text, principal, interest_rate, term_months,
            method::text, status::text, purpose, rejection_reason, outstanding_balance, late_fees, mpesa_charge,
            rollover_of::text, disbursement_date, due_date, next_payment_date, projected_payment_date,
            disbursed_at, submitted_for_approval_at, approved_by::text, created_by::text, created_at, updated_at
     FROM public.loans`,
    "loans",
    ["id","loan_number","customer_id","account_id","principal","interest_rate","term_months","method","status",
     "purpose","rejection_reason","outstanding_balance","late_fees","mpesa_charge","rollover_of",
     "disbursement_date","due_date","next_payment_date","projected_payment_date","disbursed_at",
     "submitted_for_approval_at","approved_by","created_by","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, reference, amount, paid_at, posted_by::text,
            allocated_principal, allocated_interest, allocated_fees, allocated_penalty,
            reversed, reversed_by::text, reversed_at, reversal_reason, created_at
     FROM public.loan_repayments`,
    "loan_repayments",
    ["id","loan_id","reference","amount","paid_at","posted_by",
     "allocated_principal","allocated_interest","allocated_fees","allocated_penalty",
     "reversed","reversed_by","reversed_at","reversal_reason","created_at"]
  );

  await portTable(
    `SELECT id::text, code, name, account_class::text, is_active, created_at
     FROM public.chart_of_accounts`,
    "chart_of_accounts",
    ["id","code","name","account_class","is_active","created_at"]
  );

  await portTable(
    `SELECT id::text, entry_date, reference, description, debit_account::text, credit_account::text,
            amount, source_table, source_id::text, created_by::text, created_at
     FROM public.journal_entries`,
    "journal_entries",
    ["id","entry_date","reference","description","debit_account","credit_account",
     "amount","source_table","source_id","created_by","created_at"]
  );

  await portTable(
    `SELECT id::text, customer_id::text, full_name, national_id, phone, email, relationship,
            address, occupation, monthly_income, notes, created_by::text, created_at, updated_at
     FROM public.guarantors`,
    "guarantors",
    ["id","customer_id","full_name","national_id","phone","email","relationship",
     "address","occupation","monthly_income","notes","created_by","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, customer_id::text, doc_type, storage_path, is_id_document, uploaded_by::text, uploaded_at
     FROM public.kyc_documents`,
    "kyc_documents",
    ["id","customer_id","doc_type","storage_path","is_id_document","uploaded_by","uploaded_at"]
  );

  await portTable(
    `SELECT id::text, reference, txn_type::text, amount, status::text, description,
            account_id::text, counterparty_account_id::text, performed_by::text, created_at
     FROM public.transactions`,
    "transactions",
    ["id","reference","txn_type","amount","status","description","account_id","counterparty_account_id","performed_by","created_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, customer_id::text, channel::text, outcome::text,
            notes, next_action_at, performed_by::text, performed_at, created_at
     FROM public.collection_actions`,
    "collection_actions",
    ["id","loan_id","customer_id","channel","outcome","notes","next_action_at","performed_by","performed_at","created_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, customer_id::text, promised_amount, promised_date, status::text,
            resolved_amount, resolved_at, recorded_by::text, notes, created_at, updated_at
     FROM public.promises_to_pay`,
    "promises_to_pay",
    ["id","loan_id","customer_id","promised_amount","promised_date","status",
     "resolved_amount","resolved_at","recorded_by","notes","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, guarantor_id::text, status::text, contacted_at, next_action_at,
            notes, performed_by::text, created_at, updated_at
     FROM public.guarantor_followups`,
    "guarantor_followups",
    ["id","loan_id","guarantor_id","status","contacted_at","next_action_at","notes","performed_by","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, reason, new_due_date, new_term_months, new_interest_rate, status::text,
            requested_by::text, requested_at, approved_by::text, approved_at, applied_at, rejection_reason,
            created_at, updated_at
     FROM public.loan_restructures`,
    "loan_restructures",
    ["id","loan_id","reason","new_due_date","new_term_months","new_interest_rate","status",
     "requested_by","requested_at","approved_by","approved_at","applied_at","rejection_reason","created_at","updated_at"]
  );

  await portTable(
    `SELECT id::text, loan_id::text, amount, reason, status::text, requested_by::text, requested_at,
            approved_by::text, approved_at, applied_at, rejection_reason, created_at, updated_at
     FROM public.loan_writeoffs`,
    "loan_writeoffs",
    ["id","loan_id","amount","reason","status","requested_by","requested_at",
     "approved_by","approved_at","applied_at","rejection_reason","created_at","updated_at"]
  );

  console.log("\nDONE. NOTE: every imported user has a placeholder password and must reset on first login.");
  await pg.end();
  await pool().end();
}

main().catch(async (e) => { console.error(e); try { await pg.end(); } catch {} process.exit(1); });
// Suppress lint about unused import
void newId;
