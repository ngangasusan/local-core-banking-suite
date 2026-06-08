import { Router } from "express";
import { z } from "zod";
import { query, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole, requireMfa } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { applyRepayment, reverseRepayment } from "../services/loans.js";

const r = Router();
r.use(requireAuth);

const PostBody = z.object({
  loan_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(1_000_000_000),
  reference: z.string().min(1).max(100),
  paid_at: z.string().datetime().optional(),
});

// List repayments (optionally filtered by loan_id).
r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const loan_id = typeof req.query.loan_id === "string" ? req.query.loan_id : null;
  const { limit, offset } = pageLimits(q);
  const where = loan_id ? "WHERE r.loan_id = ?" : "";
  const params: unknown[] = loan_id ? [loan_id] : [];
  const rows = await query(
    `SELECT r.id, r.loan_id, l.loan_number, r.reference, r.amount, r.paid_at,
            r.allocated_principal, r.allocated_interest, r.allocated_fees, r.allocated_penalty,
            r.reversed, r.reversed_at, r.posted_by
       FROM loan_repayments r
       JOIN loans l ON l.id = r.loan_id
       ${where}
       ORDER BY r.paid_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM loan_repayments r ${where}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

// Post a repayment (waterfall + double-entry handled in service).
r.post("/", requireRole("admin", "super_admin", "manager", "teller", "loan_officer", "finance_officer"),
  ah(async (req, res) => {
    const body = PostBody.parse(req.body);
    try {
      const out = await applyRepayment({
        loanId: body.loan_id,
        amount: body.amount,
        reference: body.reference,
        postedBy: req.user!.sub,
        paidAt: body.paid_at ? new Date(body.paid_at) : undefined,
      });
      res.status(201).json(out);
    } catch (e) {
      const msg = (e as Error).message;
      const codeMap: Record<string, number> = {
        not_found: 404, loan_not_repayable: 409, loan_not_disbursed: 409,
        amount_exceeds_payable: 400, amount_must_be_positive: 400,
      };
      if (codeMap[msg]) return res.status(codeMap[msg]).json({ error: msg });
      throw e;
    }
  }));

// Reverse a repayment — admin + MFA only (matches the legacy privileged-action policy).
const ReverseBody = z.object({ reason: z.string().min(3).max(2000) });

r.post("/:id/reverse", requireRole("admin", "super_admin"), requireMfa,
  ah(async (req, res) => {
    const body = ReverseBody.parse(req.body);
    try {
      const out = await reverseRepayment({
        repaymentId: req.params.id, reversedBy: req.user!.sub, reason: body.reason,
      });
      res.json(out);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "not_found") return res.status(404).json({ error: msg });
      if (msg === "already_reversed") return res.status(409).json({ error: msg });
      throw e;
    }
  }));

export default r;
