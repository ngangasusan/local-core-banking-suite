import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { portfolioSummary, agingBuckets, profitAndLoss, balanceSheet } from "../services/reports.js";

const r = Router();
r.use(requireAuth);
r.use(requireRole("admin", "super_admin", "manager", "finance_officer", "auditor"));

r.get("/portfolio", ah(async (_req, res) => res.json(await portfolioSummary())));
r.get("/aging", ah(async (_req, res) => res.json({ rows: await agingBuckets() })));

r.get("/pnl", ah(async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to   = typeof req.query.to   === "string" ? req.query.to   : null;
  res.json(await profitAndLoss(from, to));
}));

r.get("/balance-sheet", ah(async (req, res) => {
  const asOf = typeof req.query.as_of === "string" ? req.query.as_of : null;
  res.json(await balanceSheet(asOf));
}));

export default r;
