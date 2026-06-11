import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAuth, requireRole, requireMfa, hasRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { requestWriteoff, decideWriteoff } from "../services/writeoffs.js";

const r = Router();
r.use(requireAuth);

const RequestBody = z.object({
  loan_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  reason: z.string().min(3).max(2000),
});

const DecideBody = z.object({
  decision: z.enum(["approve", "reject"]),
  rejection_reason: z.string().max(2000).optional(),
});

r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const where = status ? "WHERE status = ?" : "";
  const params = status ? [status] : [];
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT * FROM loan_writeoffs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, limit, offset });
}));

r.post("/", requireRole("admin", "super_admin", "manager", "finance_officer"),
  ah(async (req, res) => {
    const body = RequestBody.parse(req.body);
    try {
      const out = await requestWriteoff({
        loanId: body.loan_id, amount: body.amount, reason: body.reason,
        requestedBy: req.user!.sub,
      });
      res.status(201).json(out);
    } catch (e) {
      const msg = (e as Error).message;
      const map: Record<string, number> = {
        not_found: 404, loan_not_writeoffable: 409,
        exceeds_outstanding: 422, amount_must_be_positive: 400,
      };
      if (map[msg]) return res.status(map[msg]).json({ error: msg });
      throw e;
    }
  }));

// Approval requires MFA: writing off money is a privileged action.
r.post("/:id/decision",
  requireRole("admin", "super_admin"), requireMfa,
  ah(async (req, res) => {
    const body = DecideBody.parse(req.body);
    try {
      const out = await decideWriteoff(req.params.id, req.user!.sub,
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
