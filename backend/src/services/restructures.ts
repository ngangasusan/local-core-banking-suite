// Loan restructures: request, approve (and apply new terms), reject.
import type { RowDataPacket } from "mysql2";
import { tx } from "../db.js";
import { newId } from "../util/uuid.js";
import { writeAudit } from "./audit.js";

export interface RequestRestructureInput {
  loanId: string;
  reason: string;
  newDueDate: string;          // yyyy-mm-dd
  newTermMonths?: number | null;
  newInterestRate?: number | null;
  requestedBy: string;
}

export async function requestRestructure(input: RequestRestructureInput): Promise<{ id: string }> {
  return tx(async (cx) => {
    const [rows] = await cx.query<(RowDataPacket & { status: string })[]>(
      "SELECT status FROM loans WHERE id = ? FOR UPDATE", [input.loanId]
    );
    const loan = rows[0];
    if (!loan) throw new Error("not_found");
    if (!["active", "in_arrears", "disbursed"].includes(loan.status))
      throw new Error("loan_not_restructurable");

    const id = newId();
    await cx.query(
      `INSERT INTO loan_restructures
         (id, loan_id, reason, new_due_date, new_term_months, new_interest_rate, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.loanId, input.reason, input.newDueDate,
       input.newTermMonths ?? null, input.newInterestRate ?? null, input.requestedBy]
    );
    await writeAudit({
      userId: input.requestedBy, action: "INSERT", table: "loan_restructures", recordId: id,
      newData: { loan_id: input.loanId, ...input },
    }, cx);
    return { id };
  });
}

export async function decideRestructure(
  rsId: string, actorId: string,
  decision: "approve" | "reject", rejectionReason?: string,
  opts: { bypassFourEyes?: boolean } = {},
): Promise<{ ok: true }> {
  return tx(async (cx) => {
    const [rows] = await cx.query<(RowDataPacket & {
      id: string; loan_id: string; status: string; requested_by: string | null;
      new_due_date: string; new_term_months: number | null; new_interest_rate: string | null;
    })[]>(
      "SELECT id, loan_id, status, requested_by, new_due_date, new_term_months, new_interest_rate FROM loan_restructures WHERE id = ? FOR UPDATE",
      [rsId]
    );
    const rs = rows[0];
    if (!rs) throw new Error("not_found");
    if (rs.status !== "pending") throw new Error("not_pending");
    if (!opts.bypassFourEyes && rs.requested_by && rs.requested_by === actorId)
      throw new Error("four_eyes_violation");

    if (decision === "reject") {
      await cx.query(
        `UPDATE loan_restructures SET status='rejected', approved_by=?, approved_at=NOW(3), rejection_reason=? WHERE id=?`,
        [actorId, rejectionReason ?? "rejected", rsId]
      );
      await writeAudit({
        userId: actorId, action: "UPDATE", table: "loan_restructures", recordId: rsId,
        newData: { status: "rejected" },
      }, cx);
      return { ok: true };
    }

    // approve + apply
    const sets: string[] = ["due_date = ?", "next_payment_date = ?"];
    const params: unknown[] = [rs.new_due_date, rs.new_due_date];
    if (rs.new_term_months !== null) { sets.push("term_months = ?"); params.push(rs.new_term_months); }
    if (rs.new_interest_rate !== null) { sets.push("interest_rate = ?"); params.push(rs.new_interest_rate); }
    params.push(rs.loan_id);
    await cx.query(`UPDATE loans SET ${sets.join(", ")} WHERE id = ?`, params);

    await cx.query(
      `UPDATE loan_restructures SET status='applied', approved_by=?, approved_at=NOW(3), applied_at=NOW(3) WHERE id=?`,
      [actorId, rsId]
    );
    await writeAudit({
      userId: actorId, action: "UPDATE", table: "loan_restructures", recordId: rsId,
      newData: { status: "applied" },
    }, cx);
    return { ok: true };
  });
}
