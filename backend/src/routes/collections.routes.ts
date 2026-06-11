// Collections: collection_actions, promises_to_pay, guarantor_followups.
import { Router } from "express";
import { z } from "zod";
import { exec, query, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

const STAFF = ["admin", "super_admin", "manager", "loan_officer", "finance_officer"] as const;

// ----- collection actions -----
const ActionBody = z.object({
  loan_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  channel: z.enum(["call", "sms", "email", "visit", "letter", "whatsapp", "other"]),
  outcome: z.enum(["reached", "no_answer", "promise", "refused", "wrong_number", "paid", "other"]),
  notes: z.string().max(4000).optional().nullable(),
  next_action_at: z.string().date().optional().nullable(),
});

r.get("/actions", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const loanId = typeof req.query.loan_id === "string" ? req.query.loan_id : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (loanId) { where.push("loan_id = ?"); params.push(loanId); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT * FROM collection_actions ${w} ORDER BY performed_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM collection_actions ${w}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.post("/actions", requireRole(...STAFF), ah(async (req, res) => {
  const body = ActionBody.parse(req.body);
  const id = newId();
  await exec(
    `INSERT INTO collection_actions
       (id, loan_id, customer_id, channel, outcome, notes, next_action_at, performed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, body.loan_id, body.customer_id, body.channel, body.outcome,
     body.notes ?? null, body.next_action_at ?? null, req.user!.sub]
  );
  await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "collection_actions", recordId: id, newData: body });
  res.status(201).json({ id });
}));

// ----- promises to pay -----
const PtpBody = z.object({
  loan_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  promised_amount: z.coerce.number().positive(),
  promised_date: z.string().date(),
  notes: z.string().max(4000).optional().nullable(),
});

const PtpResolve = z.object({
  status: z.enum(["kept", "broken", "partial", "cancelled"]),
  resolved_amount: z.coerce.number().min(0).optional(),
  notes: z.string().max(4000).optional().nullable(),
});

r.get("/promises", ah(async (req, res) => {
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
    `SELECT * FROM promises_to_pay ${w} ORDER BY promised_date ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM promises_to_pay ${w}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.post("/promises", requireRole(...STAFF), ah(async (req, res) => {
  const body = PtpBody.parse(req.body);
  const id = newId();
  await exec(
    `INSERT INTO promises_to_pay
       (id, loan_id, customer_id, promised_amount, promised_date, notes, recorded_by)
     VALUES (?, ?, ?, ROUND(?, 2), ?, ?, ?)`,
    [id, body.loan_id, body.customer_id, body.promised_amount, body.promised_date,
     body.notes ?? null, req.user!.sub]
  );
  await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "promises_to_pay", recordId: id, newData: body });
  res.status(201).json({ id });
}));

r.post("/promises/:id/resolve", requireRole(...STAFF), ah(async (req, res) => {
  const body = PtpResolve.parse(req.body);
  const r0 = await exec(
    `UPDATE promises_to_pay
        SET status = ?, resolved_amount = ROUND(?, 2), resolved_at = NOW(3), notes = COALESCE(?, notes)
      WHERE id = ? AND status = 'open'`,
    [body.status, body.resolved_amount ?? 0, body.notes ?? null, req.params.id]
  );
  if (r0.affectedRows === 0) return res.status(409).json({ error: "not_open" });
  await writeAudit({
    userId: req.user!.sub, action: "UPDATE", table: "promises_to_pay",
    recordId: req.params.id, newData: body,
  });
  res.json({ ok: true });
}));

// ----- guarantor follow-ups -----
const GfBody = z.object({
  loan_id: z.string().uuid(),
  guarantor_id: z.string().uuid(),
  status: z.enum(["pending", "contacted", "committed", "refused", "unreachable", "resolved"]).default("pending"),
  contacted_at: z.string().datetime().optional().nullable(),
  next_action_at: z.string().date().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

r.get("/guarantor-followups", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const loanId = typeof req.query.loan_id === "string" ? req.query.loan_id : null;
  const where = loanId ? "WHERE loan_id = ?" : "";
  const params = loanId ? [loanId] : [];
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT * FROM guarantor_followups ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, limit, offset });
}));

r.post("/guarantor-followups", requireRole(...STAFF), ah(async (req, res) => {
  const body = GfBody.parse(req.body);
  const id = newId();
  await exec(
    `INSERT INTO guarantor_followups
       (id, loan_id, guarantor_id, status, contacted_at, next_action_at, notes, performed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, body.loan_id, body.guarantor_id, body.status,
     body.contacted_at ?? null, body.next_action_at ?? null, body.notes ?? null, req.user!.sub]
  );
  await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "guarantor_followups", recordId: id, newData: body });
  res.status(201).json({ id });
}));

// ----- arrears worklist (overdue loans) -----
r.get("/arrears", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT l.id, l.loan_number, l.customer_id, c.full_name AS customer_name,
            l.outstanding_balance, l.late_fees, l.due_date, l.status,
            GREATEST(DATEDIFF(CURDATE(), l.due_date), 0) AS dpd
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
      WHERE l.status IN ('active','in_arrears')
        AND l.due_date IS NOT NULL AND l.due_date < CURDATE()
        AND l.outstanding_balance > 0
      ORDER BY dpd DESC
      LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({ rows, limit, offset });
}));

export default r;
