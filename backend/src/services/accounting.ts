// Double-entry posting helper. All journal entries go through postJE so we can
// enforce the same rules the Postgres je_validate trigger enforced: distinct
// accounts, positive amount, and a balanced single-line Dr/Cr row.
import type { PoolConnection } from "../db.js";
import { newId } from "../util/uuid.js";

export const COA = {
  CASH: "1000",
  LOANS_RECEIVABLE: "1100",
  CUSTOMER_DEPOSITS: "2000",
  EQUITY: "3000",
  INTEREST_INCOME: "4000",
  PENALTY_INCOME: "4100",
  FEE_INCOME: "4200",
  OPEX: "5000",
  BAD_DEBT: "5100",
} as const;

export type CoaCode = (typeof COA)[keyof typeof COA];

export async function getCoaId(cx: PoolConnection, code: CoaCode): Promise<string> {
  const [rows] = await cx.query<({ id: string } & import("mysql2").RowDataPacket)[]>(
    "SELECT id FROM chart_of_accounts WHERE code = ? AND is_active = 1 LIMIT 1",
    [code]
  );
  const r = rows[0];
  if (!r) throw new Error(`coa_missing:${code}`);
  return r.id;
}

export interface JEInput {
  entryDate: string; // yyyy-mm-dd
  reference: string;
  description: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number; // > 0, will be ROUND(2)'d in SQL
  sourceTable: string;
  sourceId: string;
  createdBy: string | null;
}

export async function postJE(cx: PoolConnection, j: JEInput): Promise<string> {
  if (!(j.amount > 0)) throw new Error("je_amount_must_be_positive");
  if (j.debitAccountId === j.creditAccountId) throw new Error("je_same_account");
  const id = newId();
  await cx.query(
    `INSERT INTO journal_entries
       (id, entry_date, reference, description, debit_account, credit_account, amount,
        source_table, source_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ROUND(?, 2), ?, ?, ?)`,
    [
      id, j.entryDate, j.reference, j.description,
      j.debitAccountId, j.creditAccountId, j.amount,
      j.sourceTable, j.sourceId, j.createdBy,
    ]
  );
  return id;
}
