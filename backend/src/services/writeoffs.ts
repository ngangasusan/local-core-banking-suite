// Loan write-offs. Posts Dr Bad Debt / Cr Loans Receivable atomically when applied.
import type { RowDataPacket } from "mysql2";
import { tx } from "../db.js";
import { newId } from "../util/uuid.js";
import { COA, getCoaId, postJE } from "./accounting.js";
import { writeAudit } from "./audit.js";
import { isoDate } from "./money.js";

export interface RequestWriteoffInput {
  loanId: string; amount: number; reason: string; requestedBy: string;
}

export async function requestWriteoff(input: RequestWriteoffInput): Promise<{ id: string }> {
  if (!(input.amount > 0)) throw new Error("amount_must_be_positive");
  return tx(async (cx) => {
    const [rows] = await cx.query<(RowDataPacket & { status: string; outstanding_balance: string })[]>(
      "SELECT status, outstanding_balance FROM loans WHERE id = ? FOR UPDATE", [input.loanId]
    );
    const loan = rows[0];
    if (!loan) throw new Error("not_found");
    if (!["active", "in_arrears"].includes(loan.status)) throw new Error("loan_not_writeoffable");
    if (input.amount > Number(loan.outstanding_balance) + 0.01) throw new Error("exceeds_outstanding");

    const id = newId();
    await cx.query(
      `INSERT INTO loan_writeoffs (id, loan_id, amount, reason, requested_by)
       VALUES (?, ?, ROUND(?, 2), ?, ?)`,
      [id, input.loanId, input.amount, input.reason, input.requestedBy]
    );
    await writeAudit({
      userId: input.requestedBy, action: "INSERT", table: "loan_writeoffs", recordId: id,
      newData: { loan_id: input.loanId, amount: input.amount, reason: input.reason },
    }, cx);
    return { id };
  });
}

export async function decideWriteoff(
  writeoffId: string, actorId: string,
  decision: "approve" | "reject", rejectionReason?: string,
  opts: { bypassFourEyes?: boolean } = {},
): Promise<{ ok: true; je_id?: string }> {
  return tx(async (cx) => {
    const [rows] = await cx.query<(RowDataPacket & {
      id: string; loan_id: string; amount: string; status: string; requested_by: string | null;
    })[]>("SELECT id, loan_id, amount, status, requested_by FROM loan_writeoffs WHERE id = ? FOR UPDATE", [writeoffId]);
    const wo = rows[0];
    if (!wo) throw new Error("not_found");
    if (wo.status !== "pending") throw new Error("not_pending");
    if (!opts.bypassFourEyes && wo.requested_by && wo.requested_by === actorId)
      throw new Error("four_eyes_violation");

    if (decision === "reject") {
      await cx.query(
        `UPDATE loan_writeoffs SET status='rejected', approved_by=?, approved_at=NOW(3), rejection_reason=? WHERE id=?`,
        [actorId, rejectionReason ?? "rejected", writeoffId]
      );
      await writeAudit({
        userId: actorId, action: "UPDATE", table: "loan_writeoffs", recordId: writeoffId,
        newData: { status: "rejected" },
      }, cx);
      return { ok: true };
    }

    // approve + apply: post JE and reduce outstanding
    const [lrows] = await cx.query<(RowDataPacket & { loan_number: string; outstanding_balance: string })[]>(
      "SELECT loan_number, outstanding_balance FROM loans WHERE id = ? FOR UPDATE", [wo.loan_id]
    );
    const loan = lrows[0];
    if (!loan) throw new Error("loan_missing");

    const amount = Number(wo.amount);
    const ar = await getCoaId(cx, COA.LOANS_RECEIVABLE);
    const badDebt = await getCoaId(cx, COA.BAD_DEBT);
    const jeId = await postJE(cx, {
      entryDate: isoDate(new Date()),
      reference: `WO-${loan.loan_number}`,
      description: `Write-off ${loan.loan_number}`,
      debitAccountId: badDebt,
      creditAccountId: ar,
      amount,
      sourceTable: "loan_writeoffs",
      sourceId: writeoffId,
      createdBy: actorId,
    });

    const newOutstanding = Math.max(Number(loan.outstanding_balance) - amount, 0);
    const newStatus = newOutstanding <= 0.005 ? "closed" : "in_arrears";
    await cx.query(
      `UPDATE loans SET outstanding_balance = ROUND(?, 2), status = ? WHERE id = ?`,
      [newOutstanding, newStatus, wo.loan_id]
    );
    await cx.query(
      `UPDATE loan_writeoffs SET status='applied', approved_by=?, approved_at=NOW(3), applied_at=NOW(3) WHERE id=?`,
      [actorId, writeoffId]
    );
    await writeAudit({
      userId: actorId, action: "UPDATE", table: "loan_writeoffs", recordId: writeoffId,
      newData: { status: "applied", je_id: jeId },
    }, cx);
    return { ok: true, je_id: jeId };
  });
}
