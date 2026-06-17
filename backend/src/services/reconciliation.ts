// Bank reconciliation — match incoming statement lines to loan repayments by
// reference + amount. Manual override available via routes.
import { exec, query, tx, type RowDataPacket } from "../db.js";
import { newId } from "../util/uuid.js";

export interface StatementLineInput {
  txn_date: string;        // yyyy-mm-dd
  reference: string;       // bank reference / narration token
  description?: string | null;
  amount: number;          // positive decimal
  direction: "credit" | "debit";
}

export interface StatementInput {
  bank_name: string;
  account_ref: string;
  period_start: string;
  period_end: string;
  opening_bal?: number;
  closing_bal?: number;
  lines: StatementLineInput[];
}

export async function importStatement(input: StatementInput, importedBy: string): Promise<{
  statement_id: string; line_count: number; auto_matched: number;
}> {
  return tx(async (cx) => {
    const sid = newId();
    await cx.query(
      `INSERT INTO bank_statements
        (id, bank_name, account_ref, period_start, period_end, opening_bal, closing_bal, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sid, input.bank_name, input.account_ref, input.period_start, input.period_end,
       input.opening_bal ?? 0, input.closing_bal ?? 0, importedBy]
    );

    let autoMatched = 0;
    for (const l of input.lines) {
      const lid = newId();
      // Auto-match: credit lines whose reference exactly matches a non-reversed
      // loan_repayments.reference with the same amount (within 1 cent).
      let matchedRepId: string | null = null;
      if (l.direction === "credit") {
        const [rep] = await cx.query<(RowDataPacket & { id: string })[]>(
          `SELECT lr.id
             FROM loan_repayments lr
            WHERE lr.reversed = 0
              AND lr.reference = ?
              AND ABS(lr.amount - ?) < 0.01
              AND NOT EXISTS (
                SELECT 1 FROM bank_statement_lines x
                 WHERE x.matched_repayment_id = lr.id
              )
            LIMIT 1`,
          [l.reference, l.amount]
        );
        if (rep[0]) { matchedRepId = rep[0].id; autoMatched++; }
      }
      await cx.query(
        `INSERT INTO bank_statement_lines
          (id, statement_id, txn_date, reference, description, amount, direction,
           status, matched_repayment_id, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lid, sid, l.txn_date, l.reference, l.description ?? null, l.amount, l.direction,
         matchedRepId ? "matched" : "unmatched", matchedRepId, matchedRepId ? new Date() : null]
      );
    }

    return { statement_id: sid, line_count: input.lines.length, auto_matched: autoMatched };
  });
}

export async function manualMatch(lineId: string, repaymentId: string, userId: string): Promise<void> {
  await tx(async (cx) => {
    const [line] = await cx.query<(RowDataPacket & {
      amount: string; direction: string; status: string;
    })[]>("SELECT amount, direction, status FROM bank_statement_lines WHERE id = ? FOR UPDATE", [lineId]);
    if (!line[0]) throw new Error("line_not_found");
    if (line[0].status === "matched") throw new Error("line_already_matched");
    if (line[0].direction !== "credit") throw new Error("line_not_credit");

    const [rep] = await cx.query<(RowDataPacket & { id: string; amount: string; reversed: number })[]>(
      "SELECT id, amount, reversed FROM loan_repayments WHERE id = ? FOR UPDATE", [repaymentId]
    );
    if (!rep[0]) throw new Error("repayment_not_found");
    if (rep[0].reversed) throw new Error("repayment_reversed");

    const [dup] = await cx.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM bank_statement_lines WHERE matched_repayment_id = ?",
      [repaymentId]
    );
    if (dup[0] && dup[0].c > 0) throw new Error("repayment_already_matched");

    await cx.query(
      `UPDATE bank_statement_lines
          SET status = 'matched', matched_repayment_id = ?, matched_by = ?, matched_at = NOW(3)
        WHERE id = ?`,
      [repaymentId, userId, lineId]
    );
  });
}

export async function unmatch(lineId: string): Promise<void> {
  await exec(
    `UPDATE bank_statement_lines
        SET status = 'unmatched', matched_repayment_id = NULL, matched_by = NULL, matched_at = NULL
      WHERE id = ?`, [lineId]
  );
}

export async function ignoreLine(lineId: string, notes: string | null): Promise<void> {
  await exec(
    `UPDATE bank_statement_lines SET status = 'ignored', notes = ? WHERE id = ?`,
    [notes, lineId]
  );
}

export interface ReconciliationSummary {
  total_lines: number;
  matched: number;
  unmatched: number;
  ignored: number;
  credit_total: number;
  matched_total: number;
  variance: number;
}

export async function summary(statementId: string): Promise<ReconciliationSummary> {
  const rows = await query<RowDataPacket & {
    status: string; direction: string; total: string; n: number;
  }>(
    `SELECT status, direction, SUM(amount) AS total, COUNT(*) AS n
       FROM bank_statement_lines WHERE statement_id = ?
       GROUP BY status, direction`,
    [statementId]
  );
  const out: ReconciliationSummary = {
    total_lines: 0, matched: 0, unmatched: 0, ignored: 0,
    credit_total: 0, matched_total: 0, variance: 0,
  };
  for (const r of rows) {
    const n = Number(r.n);
    const t = Number(r.total);
    out.total_lines += n;
    if (r.status === "matched") { out.matched += n; out.matched_total += t; }
    else if (r.status === "unmatched") out.unmatched += n;
    else if (r.status === "ignored") out.ignored += n;
    if (r.direction === "credit") out.credit_total += t;
  }
  out.variance = Math.round((out.credit_total - out.matched_total) * 100) / 100;
  return out;
}
