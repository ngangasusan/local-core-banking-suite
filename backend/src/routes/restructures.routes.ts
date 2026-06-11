import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth, requireRole, hasRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { requestRestructure, decideRestructure } from "../services/restructures.js";

const r = Router();
r.use(requireAuth);

const RequestBody = z.object({
  loan_id: z.string().uuid(),
  reason: z.string().min(3).max(2000),
  new_due_date: z.string().date(),
  new_term_months: z.coerce.number().int().min(1).max(600).optional().nullable(),
  new_interest_rate: z.coerce.number().min(0).max(1).optional().nullable(),
});

const DecideBody = z.object({
  decision: z.enum(["approve", "reject"]),
  rejection_reason: z.string().max(2000).optional(),
});

r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const loanId = typeof req.query.loan_id === "string" ? req.query.loan_id : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (loanId) { where.push("loan_id = ?"); params.push(loanId); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT * FROM loan_restructures ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, limit, offset });
}));

r.post("/", requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    const body = RequestBody.parse(req.body);
    try {
      const out = await requestRestructure({
        loanId: body.loan_id, reason: body.reason, newDueDate: body.new_due_date,
        newTermMonths: body.new_term_months ?? null, newInterestRate: body.new_interest_rate ?? null,
        requestedBy: req.user!.sub,
      });
      res.status(201).json(out);
    } catch (e) {
      const msg = (e as Error).message;
      const map: Record<string, number> = { not_found: 404, loan_not_restructurable: 409 };
      if (map[msg]) return res.status(map[msg]).json({ error: msg });
      throw e;
    }
  }));

r.post("/:id/decision", requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const body = DecideBody.parse(req.body);
    try {
      const out = await decideRestructure(req.params.id, req.user!.sub,
        body.decision, body.rejection_reason,
        { bypassFourEyes: hasRole(req, "super_admin") }
      );
      res.json(out);
    } catch (e) {
      const msg = (e as Error).message;
      const map: Record<string, number> = {
        not_found: 404, not_pending: 409, four_eyes_violation: 403,
      };
      if (map[msg]) return res.status(map[msg]).json({ error: msg });
      throw e;
    }
  }));

export default r;
