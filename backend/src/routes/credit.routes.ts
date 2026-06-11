import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { computeCreditScore } from "../services/credit.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

r.post("/customers/:id/score",
  requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    try {
      const out = await computeCreditScore(req.params.id);
      await writeAudit({
        userId: req.user!.sub, action: "UPDATE", table: "customers",
        recordId: req.params.id, newData: { credit_score: out.score },
      });
      res.json(out);
    } catch (e) {
      if ((e as Error).message === "customer_not_found")
        return res.status(404).json({ error: "not_found" });
      throw e;
    }
  }));

export default r;
