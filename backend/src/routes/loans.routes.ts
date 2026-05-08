import { Router } from "express";
import { z } from "zod";
import { exec, query, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { ListQuery, pageLimits, safeOrderBy } from "../util/listing.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

// PR 2 covers the application lifecycle (draft → submitted → approved/rejected).
// Disbursement, repayment, accruals, write-off etc. land in PR 3 / PR 4.

const LOAN_STATUSES = [
  "draft", "pending", "approved", "rejected", "disbursed",
  "active", "in_arrears", "closed",
] as const;

const ApplyBody = z.object({
  loan_number: z.string().min(1).max(50),
  customer_id: z.string().uuid(),
  account_id: z.string().uuid().optional().nullable(),
  principal: z.coerce.number().positive().max(1_000_000_000),
  interest_rate: z.coerce.number().min(0).max(1),
  term_months: z.coerce.number().int().min(1).max(600),
  method: z.enum(["flat", "reducing_balance", "daily_accrual"]).default("reducing_balance"),
  purpose: z.string().max(2000).optional().nullable(),
});

const SORTABLE = ["created_at", "loan_number", "principal", "status", "due_date"] as const;

r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const customer_id = typeof req.query.customer_id === "string" ? req.query.customer_id : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q) {
    where.push("(l.loan_number LIKE ? OR c.full_name LIKE ?)");
    const lk = `%${q.q}%`;
    params.push(lk, lk);
  }
  if (status && (LOAN_STATUSES as readonly string[]).includes(status)) {
    where.push("l.status = ?");
    params.push(status);
  }
  if (customer_id) {
    where.push("l.customer_id = ?");
    params.push(customer_id);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { limit, offset } = pageLimits(q);

  const rows = await query(
    `SELECT l.id, l.loan_number, l.customer_id, c.full_name AS customer_name,
            l.principal, l.interest_rate, l.term_months, l.method, l.status,
            l.outstanding_balance, l.late_fees, l.disbursement_date, l.due_date,
            l.next_payment_date, l.created_at
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       ${whereSql}
       ${safeOrderBy(q, SORTABLE, "created_at").replace(/ORDER BY (\w+)/, (_m, c1) => `ORDER BY l.${c1}`)}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM loans l JOIN customers c ON c.id = l.customer_id ${whereSql}`,
    params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.get("/:id", ah(async (req, res) => {
  const [row] = await query("SELECT * FROM loans WHERE id = ? LIMIT 1", [req.params.id]);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
}));

// Apply for a loan — saved as `pending` for approval.
r.post("/", requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    const body = ApplyBody.parse(req.body);
    const id = newId();
    try {
      await exec(
        `INSERT INTO loans
         (id, loan_number, customer_id, account_id, principal, interest_rate, term_months, method,
          status, purpose, outstanding_balance, submitted_for_approval_at, created_by)
         VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?, NOW(3), ?)`,
        [id, body.loan_number, body.customer_id, body.account_id ?? null,
         body.principal, body.interest_rate, body.term_months, body.method,
         body.purpose ?? null, body.principal, req.user!.sub]
      );
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "loan_number_taken" });
      if ((e as { code?: string }).code === "ER_NO_REFERENCED_ROW_2")
        return res.status(400).json({ error: "invalid_reference" });
      throw e;
    }
    await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "loans", recordId: id, newData: { ...body, id } });
    res.status(201).json({ id });
  }));

// Approve / reject a pending loan (manager+). Disbursement is PR 3.
const DecideBody = z.object({
  decision: z.enum(["approve", "reject"]),
  rejection_reason: z.string().max(2000).optional(),
});

r.post("/:id/decision", requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const body = DecideBody.parse(req.body);
    const [loan] = await query<RowDataPacket & { status: string }>(
      "SELECT status FROM loans WHERE id = ? LIMIT 1", [req.params.id]
    );
    if (!loan) return res.status(404).json({ error: "not_found" });
    if (loan.status !== "pending") return res.status(409).json({ error: "not_pending" });

    if (body.decision === "approve") {
      await exec(
        `UPDATE loans SET status = 'approved', approved_by = ? WHERE id = ?`,
        [req.user!.sub, req.params.id]
      );
    } else {
      await exec(
        `UPDATE loans SET status = 'rejected', rejection_reason = ? WHERE id = ?`,
        [body.rejection_reason ?? "rejected", req.params.id]
      );
    }
    await writeAudit({
      userId: req.user!.sub, action: "UPDATE", table: "loans",
      recordId: req.params.id, newData: { decision: body.decision },
    });
    res.json({ ok: true });
  }));

// Cancel a draft/pending loan (creator or manager).
r.delete("/:id", requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    const [loan] = await query<RowDataPacket & { status: string; created_by: string | null }>(
      "SELECT status, created_by FROM loans WHERE id = ? LIMIT 1", [req.params.id]
    );
    if (!loan) return res.status(404).json({ error: "not_found" });
    if (loan.status !== "draft" && loan.status !== "pending")
      return res.status(409).json({ error: "cannot_cancel" });
    await exec("DELETE FROM loans WHERE id = ?", [req.params.id]);
    await writeAudit({ userId: req.user!.sub, action: "DELETE", table: "loans", recordId: req.params.id });
    res.json({ ok: true });
  }));

export default r;
