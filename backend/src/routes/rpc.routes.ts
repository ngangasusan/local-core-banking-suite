// Whitelisted RPCs — the MySQL replacements for the old Postgres SECURITY
// DEFINER functions the UI used to call via supabase.rpc().
//
// POST /rpc/:name  { ...args }  →  JSON result

import { Router } from "express";
import { exec, query, tx, type RowDataPacket } from "../db.js";
import { requireAuth, hasRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { verifyAuditChain } from "../services/audit.js";
import { computeCreditScore } from "../services/credit.js";
import { recomputeProvisions } from "../services/provisions.js";
import { decideRestructure } from "../services/restructures.js";
import { decideWriteoff } from "../services/writeoffs.js";
import { decryptPII } from "../services/pii.js";
import { computeInterest, computeLateFee, mpesaSendCharge, round2 } from "../services/money.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

const num = (v: unknown) => Number(v ?? 0);

type Handler = (args: Record<string, unknown>, req: import("express").Request) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async qualified_loan_amount(args) {
    const id = String(args._customer_id ?? args.customer_id ?? "");
    const [cust] = await query<RowDataPacket & { monthly_income: string | null; credit_score: number }>(
      "SELECT monthly_income, credit_score FROM customers WHERE id = ? LIMIT 1", [id]
    );
    if (!cust) return 0;
    const [acc] = await query<RowDataPacket & { bal: string }>(
      "SELECT COALESCE(SUM(balance),0) AS bal FROM accounts WHERE customer_id = ? AND status='active'", [id]
    );
    const [ln] = await query<RowDataPacket & { out: string }>(
      `SELECT COALESCE(SUM(outstanding_balance),0) AS \`out\` FROM loans
        WHERE customer_id = ? AND status IN ('active','in_arrears','disbursed')`, [id]
    );
    const income = num(cust.monthly_income);
    const score = cust.credit_score ?? 650;
    const base = Math.max(income * 0.5, num(acc?.bal) * 2);
    const factor = Math.min(1.5, Math.max(0.3, 0.3 + ((score - 300) / 550) * 1.2));
    return round2(Math.max(0, base * factor - num(ln?.out)));
  },

  async decrypt_customer_pii(args, req) {
    if (!hasRole(req, "admin", "super_admin", "manager", "auditor")) throw new Error("forbidden");
    const id = String(args._customer_id ?? args.customer_id ?? "");
    const [row] = await query<RowDataPacket & {
      national_id_enc: Buffer | null; phone_enc: Buffer | null; email_enc: Buffer | null; dob_enc: Buffer | null;
    }>("SELECT national_id_enc, phone_enc, email_enc, dob_enc FROM customer_pii_vault WHERE customer_id = ?", [id]);
    await writeAudit({ userId: req.user!.sub, action: "SELECT", table: "customer_pii_vault", recordId: id });
    if (!row) return [];
    return [{
      national_id: decryptPII(row.national_id_enc),
      phone: decryptPII(row.phone_enc),
      email: decryptPII(row.email_enc),
      dob: decryptPII(row.dob_enc),
    }];
  },

  async verify_customer_kyc(args, req) {
    const id = String(args._customer_id ?? "");
    const approve = args._approve === true || args._approve === "true";
    const reason = (args._reason as string | null) ?? null;
    if (!hasRole(req, "admin", "super_admin", "manager", "auditor")) throw new Error("forbidden");
    return tx(async (cx) => {
      const [rows] = await cx.query<(RowDataPacket & { kyc_submitted_by: string | null })[]>(
        "SELECT kyc_submitted_by FROM customers WHERE id = ? FOR UPDATE", [id]
      );
      const cust = rows[0];
      if (!cust) throw new Error("not_found");
      if (cust.kyc_submitted_by && cust.kyc_submitted_by === req.user!.sub)
        throw new Error("four_eyes_violation");
      await cx.query(
        `UPDATE customers
            SET kyc_status = ?, kyc_verified_by = ?, kyc_verified_at = NOW(3), kyc_rejection_reason = ?
          WHERE id = ?`,
        [approve ? "verified" : "rejected", req.user!.sub, approve ? null : reason, id]
      );
      await writeAudit({
        userId: req.user!.sub, action: "UPDATE", table: "customers", recordId: id,
        newData: { kyc_status: approve ? "verified" : "rejected" },
      }, cx);
      return { ok: true };
    });
  },

  async mark_overdue_loans() {
    const res = await exec(
      `UPDATE loans SET status='in_arrears'
        WHERE status='active' AND due_date IS NOT NULL AND due_date < CURDATE() AND outstanding_balance > 0`
    );
    return { updated: (res as { affectedRows?: number }).affectedRows ?? 0 };
  },

  async sweep_broken_promises() {
    const rows = await query<RowDataPacket & {
      id: string; loan_id: string; promised_amount: string; created_at: string;
    }>(`SELECT id, loan_id, promised_amount, created_at FROM promises_to_pay
         WHERE status='open' AND promised_date < CURDATE()`);
    let count = 0;
    for (const p of rows) {
      const [agg] = await query<RowDataPacket & { paid: string }>(
        `SELECT COALESCE(SUM(amount),0) AS paid FROM loan_repayments
          WHERE loan_id = ? AND reversed = 0 AND paid_at >= ? AND DATE(paid_at) <= CURDATE()`,
        [p.loan_id, p.created_at]
      );
      const paid = num(agg?.paid);
      await exec(
        "UPDATE promises_to_pay SET status = ?, resolved_at = NOW(3), resolved_amount = ? WHERE id = ?",
        [paid >= num(p.promised_amount) ? "kept" : "broken", paid, p.id]
      );
      count++;
    }
    return count;
  },

  async portfolio_par_summary() {
    return query<RowDataPacket>(
      `SELECT bucket, COUNT(*) AS loan_count, COALESCE(SUM(outstanding_balance),0) AS outstanding
         FROM (
           SELECT outstanding_balance,
             CASE
               WHEN due_date IS NULL OR outstanding_balance <= 0 THEN 'current'
               WHEN DATEDIFF(CURDATE(), due_date) <= 0  THEN 'current'
               WHEN DATEDIFF(CURDATE(), due_date) <= 30 THEN 'par_1_30'
               WHEN DATEDIFF(CURDATE(), due_date) <= 60 THEN 'par_31_60'
               WHEN DATEDIFF(CURDATE(), due_date) <= 90 THEN 'par_61_90'
               ELSE 'par_90_plus'
             END AS bucket
           FROM loans WHERE status IN ('active','in_arrears','disbursed')
         ) a GROUP BY bucket`
    );
  },

  async loan_aging(args) {
    const [loan] = await query<RowDataPacket & { due_date: string | null; outstanding_balance: string }>(
      "SELECT due_date, outstanding_balance FROM loans WHERE id = ?", [String(args._loan_id ?? "")]
    );
    if (!loan?.due_date || num(loan.outstanding_balance) <= 0) return [{ days_past_due: 0, bucket: "current" }];
    const dpd = Math.max(0, Math.floor((Date.now() - new Date(loan.due_date).getTime()) / 86_400_000));
    const bucket = dpd === 0 ? "current" : dpd <= 30 ? "par_1_30" : dpd <= 60 ? "par_31_60"
      : dpd <= 90 ? "par_61_90" : "par_90_plus";
    return [{ days_past_due: dpd, bucket }];
  },

  async recompute_credit_score(args) {
    const out = await computeCreditScore(String(args._customer_id ?? args.customer_id ?? ""));
    return out.score;
  },

  async recompute_loan_provisions() {
    const out = await recomputeProvisions();
    return out.updated;
  },

  async verify_audit_chain() {
    const out = await verifyAuditChain();
    return [out];
  },

  async approve_loan_restructure(args, req) {
    await decideRestructure(
      String(args._id ?? ""), req.user!.sub,
      args._approve === true || args._approve === "true" ? "approve" : "reject",
      (args._reason as string | undefined) ?? undefined
    );
    return { ok: true };
  },

  async approve_loan_writeoff(args, req) {
    await decideWriteoff(
      String(args._id ?? ""), req.user!.sub,
      args._approve === true || args._approve === "true" ? "approve" : "reject",
      (args._reason as string | undefined) ?? undefined
    );
    return { ok: true };
  },

  async compute_loan_interest(args) {
    return computeInterest(num(args._principal), Number(args._days ?? 0));
  },
  async compute_loan_total_due(args) {
    const p = num(args._principal);
    return round2(p + computeInterest(p, Number(args._days ?? 0)));
  },
  async compute_late_fee(args) {
    return computeLateFee(num(args._principal), Number(args._days_past_due ?? 0));
  },
  async mpesa_send_charge(args) {
    return mpesaSendCharge(num(args._amount));
  },

  async has_role(args, req) {
    const uid = String(args._user_id ?? req.user!.sub);
    const role = String(args._role ?? "");
    const [row] = await query<RowDataPacket & { n: number }>(
      "SELECT COUNT(*) AS n FROM user_roles WHERE user_id = ? AND role = ?", [uid, role]
    );
    return Number(row?.n ?? 0) > 0;
  },

  async user_has_mfa(_args, req) {
    return !!req.user?.mfa;
  },
};

r.post("/:name", ah(async (req, res) => {
  const fn = handlers[req.params.name];
  if (!fn) return res.status(404).json({ error: `unknown_rpc:${req.params.name}` });
  try {
    const data = await fn((req.body ?? {}) as Record<string, unknown>, req);
    res.json({ data: data ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rpc_failed";
    const status = msg === "forbidden" ? 403 : msg === "not_found" ? 404 : 400;
    res.status(status).json({ error: msg });
  }
}));

export default r;
