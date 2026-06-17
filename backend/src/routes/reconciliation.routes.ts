import { Router } from "express";
import { z } from "zod";
import { query, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { writeAudit } from "../services/audit.js";
import {
  importStatement, manualMatch, unmatch, ignoreLine, summary,
} from "../services/reconciliation.js";

const r = Router();
r.use(requireAuth);

const LineSchema = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  amount: z.coerce.number().positive(),
  direction: z.enum(["credit", "debit"]),
});

const StatementSchema = z.object({
  bank_name: z.string().min(1).max(100),
  account_ref: z.string().min(1).max(100),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opening_bal: z.coerce.number().optional(),
  closing_bal: z.coerce.number().optional(),
  lines: z.array(LineSchema).min(1).max(5000),
});

// Import a bank statement (JSON). CSV parsing lives client-side.
r.post("/statements",
  requireRole("admin", "super_admin", "finance_officer", "manager"),
  ah(async (req, res) => {
    const body = StatementSchema.parse(req.body);
    const out = await importStatement(body, req.user!.sub);
    await writeAudit({
      userId: req.user!.sub, action: "INSERT", table: "bank_statements",
      recordId: out.statement_id, newData: { lines: out.line_count, auto_matched: out.auto_matched },
    });
    res.status(201).json(out);
  })
);

r.get("/statements", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT id, bank_name, account_ref, period_start, period_end,
            opening_bal, closing_bal, imported_at
       FROM bank_statements ORDER BY imported_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({ rows, limit, offset });
}));

r.get("/statements/:id", ah(async (req, res) => {
  const [stmt] = await query("SELECT * FROM bank_statements WHERE id = ?", [req.params.id]);
  if (!stmt) return res.status(404).json({ error: "not_found" });
  const sum = await summary(req.params.id);
  res.json({ statement: stmt, summary: sum });
}));

r.get("/statements/:id/lines", ah(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const params: unknown[] = [req.params.id];
  let extra = "";
  if (status && ["matched", "unmatched", "ignored"].includes(status)) {
    extra = " AND status = ?"; params.push(status);
  }
  const rows = await query(
    `SELECT id, txn_date, reference, description, amount, direction, status,
            matched_repayment_id, matched_at
       FROM bank_statement_lines
      WHERE statement_id = ? ${extra}
      ORDER BY txn_date ASC, created_at ASC`,
    params
  );
  res.json({ rows });
}));

// Match a single line to an existing repayment.
r.post("/lines/:id/match",
  requireRole("admin", "super_admin", "finance_officer", "manager"),
  ah(async (req, res) => {
    const body = z.object({ repayment_id: z.string().uuid() }).parse(req.body);
    try {
      await manualMatch(req.params.id, body.repayment_id, req.user!.sub);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("line_") || msg.startsWith("repayment_"))
        return res.status(400).json({ error: msg });
      throw e;
    }
    await writeAudit({
      userId: req.user!.sub, action: "UPDATE", table: "bank_statement_lines",
      recordId: req.params.id, newData: { matched_repayment_id: body.repayment_id },
    });
    res.json({ ok: true });
  })
);

r.post("/lines/:id/unmatch",
  requireRole("admin", "super_admin", "finance_officer", "manager"),
  ah(async (req, res) => {
    await unmatch(req.params.id);
    await writeAudit({
      userId: req.user!.sub, action: "UPDATE", table: "bank_statement_lines",
      recordId: req.params.id, newData: { status: "unmatched" },
    });
    res.json({ ok: true });
  })
);

r.post("/lines/:id/ignore",
  requireRole("admin", "super_admin", "finance_officer", "manager"),
  ah(async (req, res) => {
    const body = z.object({ notes: z.string().max(1000).optional() }).parse(req.body);
    await ignoreLine(req.params.id, body.notes ?? null);
    await writeAudit({
      userId: req.user!.sub, action: "UPDATE", table: "bank_statement_lines",
      recordId: req.params.id, newData: { status: "ignored" },
    });
    res.json({ ok: true });
  })
);

// Candidate repayments for a single line (same amount, unmatched).
r.get("/lines/:id/candidates", ah(async (req, res) => {
  const [line] = await query<RowDataPacket & { amount: string; reference: string }>(
    "SELECT amount, reference FROM bank_statement_lines WHERE id = ?",
    [req.params.id]
  );
  if (!line) return res.status(404).json({ error: "not_found" });
  const rows = await query(
    `SELECT lr.id, lr.loan_id, lr.reference, lr.amount, lr.paid_at, l.loan_number, c.full_name
       FROM loan_repayments lr
       JOIN loans l ON l.id = lr.loan_id
       JOIN customers c ON c.id = l.customer_id
      WHERE lr.reversed = 0
        AND ABS(lr.amount - ?) < 0.01
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.matched_repayment_id = lr.id)
      ORDER BY (lr.reference = ?) DESC, lr.paid_at DESC
      LIMIT 25`,
    [line.amount, line.reference]
  );
  res.json({ rows });
}));

export default r;
