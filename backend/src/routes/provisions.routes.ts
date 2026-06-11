import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { recomputeProvisions } from "../services/provisions.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

r.get("/", ah(async (_req, res) => {
  const rows = await query(
    `SELECT p.*, l.loan_number, l.customer_id, c.full_name AS customer_name
       FROM loan_provisions p
       JOIN loans l     ON l.id = p.loan_id
       JOIN customers c ON c.id = l.customer_id
      ORDER BY p.ecl_amount DESC`
  );
  res.json({ rows });
}));

r.get("/summary", ah(async (_req, res) => {
  const rows = await query(
    `SELECT stage, COUNT(*) AS loan_count,
            ROUND(SUM(exposure), 2)   AS total_exposure,
            ROUND(SUM(ecl_amount), 2) AS total_ecl
       FROM loan_provisions GROUP BY stage ORDER BY stage`
  );
  res.json({ stages: rows });
}));

r.post("/recompute",
  requireRole("admin", "super_admin", "manager", "finance_officer"),
  ah(async (req, res) => {
    const out = await recomputeProvisions();
    await writeAudit({
      userId: req.user!.sub, action: "UPDATE", table: "loan_provisions",
      recordId: null, newData: out,
    });
    res.json(out);
  }));

export default r;
