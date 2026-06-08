// Loan money lifecycle: disbursement, repayment waterfall + double-entry posting,
// repayment reversal. Replaces the Postgres post_disbursement_je + apply_repayment
// triggers. Every public function runs inside a single MySQL transaction so the
// loan row, repayment row, and journal entries either all succeed or all roll back.
import type { RowDataPacket } from "mysql2";
import { tx, type PoolConnection } from "../db.js";
import { newId } from "../util/uuid.js";
import { COA, getCoaId, postJE } from "./accounting.js";
import { writeAudit } from "./audit.js";
import {
  computeInterest, computeLateFee, mpesaSendCharge,
  daysBetween, daysPastDue, round2, isoDate, addDays,
} from "./money.js";

type LoanRow = {
  id: string; loan_number: string; customer_id: string; account_id: string | null;
  principal: string; interest_rate: string; term_months: number; method: string;
  status: string; outstanding_balance: string; late_fees: string;
  disbursement_date: string | null; due_date: string | null;
  disbursed_at: Date | null; created_by: string | null; approved_by: string | null;
};

async function lockLoan(cx: PoolConnection, loanId: string): Promise<LoanRow> {
  const [rows] = await cx.query<(LoanRow & RowDataPacket)[]>(
    "SELECT id, loan_number, customer_id, account_id, principal, interest_rate, term_months, method, status, outstanding_balance, late_fees, disbursement_date, due_date, disbursed_at, created_by, approved_by FROM loans WHERE id = ? FOR UPDATE",
    [loanId]
  );
  const row = rows[0];
  if (!row) throw new Error("not_found");
  return row;
}

// ---------------------------------------------------------------------------
// Disbursement
// ---------------------------------------------------------------------------
export interface DisburseResult { loan_id: string; je_id: string; disbursement_date: string; due_date: string; }

export async function disburseLoan(
  loanId: string, actorId: string, disbursementDate?: string
): Promise<DisburseResult> {
  return tx(async (cx) => {
    const loan = await lockLoan(cx, loanId);
    if (loan.status !== "approved") throw new Error("not_approved");
    // 4-eyes: creator cannot disburse their own loan (super_admin can override at route layer).
    if (loan.created_by && loan.created_by === actorId)
      throw new Error("four_eyes_violation");

    const disbDate = disbursementDate ?? isoDate(new Date());
    const dueDate = isoDate(addDays(new Date(disbDate + "T00:00:00Z"), 30));

    await cx.query(
      `UPDATE loans
         SET status = 'active',
             disbursement_date = ?,
             due_date = ?,
             disbursed_at = NOW(3),
             outstanding_balance = principal,
             next_payment_date = ?,
             projected_payment_date = ?
       WHERE id = ?`,
      [disbDate, dueDate, dueDate, dueDate, loanId]
    );

    const cash = await getCoaId(cx, COA.CASH);
    const ar = await getCoaId(cx, COA.LOANS_RECEIVABLE);
    const jeId = await postJE(cx, {
      entryDate: disbDate,
      reference: `DISB-${loan.loan_number}`,
      description: `Disbursement ${loan.loan_number}`,
      debitAccountId: ar,
      creditAccountId: cash,
      amount: Number(loan.principal),
      sourceTable: "loans",
      sourceId: loanId,
      createdBy: actorId,
    });

    await writeAudit({
      userId: actorId, action: "UPDATE", table: "loans", recordId: loanId,
      oldData: { status: loan.status }, newData: { status: "active", disbursement_date: disbDate, due_date: dueDate },
    }, cx);

    return { loan_id: loanId, je_id: jeId, disbursement_date: disbDate, due_date: dueDate };
  });
}

// ---------------------------------------------------------------------------
// Repayment (waterfall: penalty → fees → interest → principal)
// ---------------------------------------------------------------------------
export interface RepaymentInput {
  loanId: string;
  amount: number;
  reference: string;
  postedBy: string;
  paidAt?: Date; // defaults to now
}

export interface RepaymentResult {
  repayment_id: string;
  loan_id: string;
  allocated_penalty: number;
  allocated_fees: number;
  allocated_interest: number;
  allocated_principal: number;
  new_outstanding: number;
  loan_status: string;
}

export async function applyRepayment(input: RepaymentInput): Promise<RepaymentResult> {
  if (!(input.amount > 0)) throw new Error("amount_must_be_positive");
  return tx(async (cx) => {
    const loan = await lockLoan(cx, input.loanId);
    if (!["active", "in_arrears", "disbursed"].includes(loan.status))
      throw new Error("loan_not_repayable");
    if (!loan.disbursement_date) throw new Error("loan_not_disbursed");

    const paidAt = input.paidAt ?? new Date();
    const principal = Number(loan.principal);
    const days = daysBetween(loan.disbursement_date, paidAt);
    const dpd = daysPastDue(loan.due_date, paidAt);

    const interestDue = computeInterest(principal, days);
    const penaltyDue = computeLateFee(principal, dpd);
    const feesDue = days <= 5 ? mpesaSendCharge(principal) : 0;

    // sum prior non-reversed allocations on this loan
    const [paid] = await cx.query<(RowDataPacket & {
      p: string | null; f: string | null; i: string | null; pr: string | null;
    })[]>(
      `SELECT COALESCE(SUM(allocated_penalty),0)   AS p,
              COALESCE(SUM(allocated_fees),0)      AS f,
              COALESCE(SUM(allocated_interest),0)  AS i,
              COALESCE(SUM(allocated_principal),0) AS pr
         FROM loan_repayments WHERE loan_id = ? AND reversed = 0`,
      [input.loanId]
    );
    const paidPenalty = Number(paid[0]?.p ?? 0);
    const paidFees = Number(paid[0]?.f ?? 0);
    const paidInterest = Number(paid[0]?.i ?? 0);
    const paidPrincipal = Number(paid[0]?.pr ?? 0);

    const openPenalty = Math.max(penaltyDue - paidPenalty, 0);
    const openFees = Math.max(feesDue - paidFees, 0);
    const openInterest = Math.max(interestDue - paidInterest, 0);
    const openPrincipal = Math.max(principal - paidPrincipal, 0);

    let remaining = input.amount;
    const allocPenalty = Math.min(remaining, openPenalty);   remaining -= allocPenalty;
    const allocFees = Math.min(remaining, openFees);         remaining -= allocFees;
    const allocInterest = Math.min(remaining, openInterest); remaining -= allocInterest;
    const allocPrincipal = Math.min(remaining, openPrincipal); remaining -= allocPrincipal;
    if (remaining > 0.005) throw new Error("amount_exceeds_payable");

    const repId = newId();
    await cx.query(
      `INSERT INTO loan_repayments
         (id, loan_id, reference, amount, paid_at, posted_by,
          allocated_principal, allocated_interest, allocated_fees, allocated_penalty)
       VALUES (?, ?, ?, ROUND(?, 2), ?, ?, ROUND(?, 2), ROUND(?, 2), ROUND(?, 2), ROUND(?, 2))`,
      [
        repId, input.loanId, input.reference, input.amount, paidAt, input.postedBy,
        allocPrincipal, allocInterest, allocFees, allocPenalty,
      ]
    );

    const newOutstanding = Math.max(Number(loan.outstanding_balance) - allocPrincipal, 0);
    const totalPaidNow = paidPenalty + paidFees + paidInterest + paidPrincipal + input.amount;
    const fullyPaid = totalPaidNow >= (penaltyDue + feesDue + interestDue + principal) - 0.01;
    const newStatus = fullyPaid && ["active", "in_arrears"].includes(loan.status) ? "closed" : loan.status;
    const newLateFees = Math.max(penaltyDue - (paidPenalty + allocPenalty), 0);

    await cx.query(
      `UPDATE loans
          SET outstanding_balance = ROUND(?, 2),
              late_fees = ROUND(?, 2),
              status = ?
        WHERE id = ?`,
      [newOutstanding, newLateFees, newStatus, input.loanId]
    );

    // ---- Double-entry postings (Dr Cash for each split) ----
    const cash = await getCoaId(cx, COA.CASH);
    const ar = await getCoaId(cx, COA.LOANS_RECEIVABLE);
    const intIncome = await getCoaId(cx, COA.INTEREST_INCOME);
    const penIncome = await getCoaId(cx, COA.PENALTY_INCOME);
    const feeIncome = await getCoaId(cx, COA.FEE_INCOME);
    const entryDate = isoDate(paidAt);

    const post = (suffix: string, desc: string, credit: string, amt: number) =>
      postJE(cx, {
        entryDate, reference: `${input.reference}-${suffix}`,
        description: `${desc} ${loan.loan_number}`,
        debitAccountId: cash, creditAccountId: credit, amount: amt,
        sourceTable: "loan_repayments", sourceId: repId, createdBy: input.postedBy,
      });
    if (allocPrincipal > 0) await post("P", "Repayment principal", ar, allocPrincipal);
    if (allocInterest > 0)  await post("I", "Repayment interest",  intIncome, allocInterest);
    if (allocPenalty > 0)   await post("L", "Repayment penalty",   penIncome, allocPenalty);
    if (allocFees > 0)      await post("F", "Repayment fees",      feeIncome, allocFees);

    await writeAudit({
      userId: input.postedBy, action: "INSERT", table: "loan_repayments", recordId: repId,
      newData: { loan_id: input.loanId, amount: input.amount, allocPrincipal, allocInterest, allocFees, allocPenalty },
    }, cx);

    return {
      repayment_id: repId, loan_id: input.loanId,
      allocated_penalty: round2(allocPenalty),
      allocated_fees: round2(allocFees),
      allocated_interest: round2(allocInterest),
      allocated_principal: round2(allocPrincipal),
      new_outstanding: round2(newOutstanding),
      loan_status: newStatus,
    };
  });
}

// ---------------------------------------------------------------------------
// Reverse a repayment (privileged — requires admin + MFA at the route layer)
// ---------------------------------------------------------------------------
export interface ReverseInput { repaymentId: string; reversedBy: string; reason: string; }

export async function reverseRepayment(input: ReverseInput): Promise<{ ok: true; loan_id: string }> {
  return tx(async (cx) => {
    const [rows] = await cx.query<(RowDataPacket & {
      id: string; loan_id: string; reference: string; reversed: number;
      allocated_principal: string; allocated_interest: string;
      allocated_fees: string; allocated_penalty: string;
    })[]>(
      "SELECT id, loan_id, reference, reversed, allocated_principal, allocated_interest, allocated_fees, allocated_penalty FROM loan_repayments WHERE id = ? FOR UPDATE",
      [input.repaymentId]
    );
    const rep = rows[0];
    if (!rep) throw new Error("not_found");
    if (rep.reversed) throw new Error("already_reversed");

    await cx.query(
      `UPDATE loan_repayments
          SET reversed = 1, reversed_by = ?, reversed_at = NOW(3), reversal_reason = ?
        WHERE id = ?`,
      [input.reversedBy, input.reason, input.repaymentId]
    );

    const allocPrincipal = Number(rep.allocated_principal);
    const loan = await lockLoan(cx, rep.loan_id);
    const newOutstanding = Number(loan.outstanding_balance) + allocPrincipal;
    const newStatus = loan.status === "closed" ? "active" : loan.status;
    await cx.query(
      `UPDATE loans SET outstanding_balance = ROUND(?, 2), status = ? WHERE id = ?`,
      [newOutstanding, newStatus, rep.loan_id]
    );

    const cash = await getCoaId(cx, COA.CASH);
    const ar = await getCoaId(cx, COA.LOANS_RECEIVABLE);
    const intIncome = await getCoaId(cx, COA.INTEREST_INCOME);
    const penIncome = await getCoaId(cx, COA.PENALTY_INCOME);
    const feeIncome = await getCoaId(cx, COA.FEE_INCOME);
    const today = isoDate(new Date());

    // Counter-entries swap Dr/Cr
    const counter = (suffix: string, desc: string, debit: string, amt: number) =>
      postJE(cx, {
        entryDate: today, reference: `${rep.reference}-${suffix}-REV`,
        description: desc, debitAccountId: debit, creditAccountId: cash, amount: amt,
        sourceTable: "loan_repayments", sourceId: rep.id, createdBy: input.reversedBy,
      });
    if (allocPrincipal > 0)                  await counter("P", "Reversal principal", ar,        allocPrincipal);
    if (Number(rep.allocated_interest) > 0)  await counter("I", "Reversal interest",  intIncome, Number(rep.allocated_interest));
    if (Number(rep.allocated_penalty) > 0)   await counter("L", "Reversal penalty",   penIncome, Number(rep.allocated_penalty));
    if (Number(rep.allocated_fees) > 0)      await counter("F", "Reversal fees",      feeIncome, Number(rep.allocated_fees));

    await writeAudit({
      userId: input.reversedBy, action: "UPDATE", table: "loan_repayments", recordId: rep.id,
      oldData: { reversed: false }, newData: { reversed: true, reason: input.reason },
    }, cx);

    return { ok: true, loan_id: rep.loan_id };
  });
}
