import { Router } from "express";
import { z } from "zod";
import { exec, query, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { enqueueSms, enqueueEmail, pushNotification, drainSms, drainEmail, stubSms, stubEmail } from "../services/notifications.js";

const r = Router();
r.use(requireAuth);

// ---------- In-app notifications ----------
r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const unreadOnly = req.query.unread === "1";
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [req.user!.sub];
  if (unreadOnly) where.push("is_read = 0");
  const rows = await query(
    `SELECT id, title, body, link, category, is_read, created_at
       FROM notifications WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE ${where.join(" AND ")}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.post("/:id/read", ah(async (req, res) => {
  await exec("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    [req.params.id, req.user!.sub]);
  res.json({ ok: true });
}));

r.post("/read-all", ah(async (req, res) => {
  await exec("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [req.user!.sub]);
  res.json({ ok: true });
}));

// ---------- Outbound queues (admin views) ----------
const QueueQuery = z.object({
  status: z.enum(["pending", "sent", "failed"]).optional(),
}).merge(ListQuery);

r.get("/sms", requireRole("admin", "super_admin", "manager"), ah(async (req, res) => {
  const q = QueueQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const where: string[] = []; const params: unknown[] = [];
  if (q.status) { where.push("status = ?"); params.push(q.status); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT id, to_phone, LEFT(message, 200) AS message, status, attempts, last_error, sent_at, created_at
       FROM sms_queue ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, limit, offset });
}));

r.get("/email", requireRole("admin", "super_admin", "manager"), ah(async (req, res) => {
  const q = QueueQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const where: string[] = []; const params: unknown[] = [];
  if (q.status) { where.push("status = ?"); params.push(q.status); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT id, to_email, subject, status, attempts, last_error, sent_at, created_at
       FROM email_queue ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ rows, limit, offset });
}));

// Manual enqueue (admin)
r.post("/sms", requireRole("admin", "super_admin", "manager"), ah(async (req, res) => {
  const body = z.object({
    to: z.string().min(6).max(50),
    message: z.string().min(1).max(1000),
    customer_id: z.string().uuid().optional(),
    loan_id: z.string().uuid().optional(),
  }).parse(req.body);
  const id = await enqueueSms({
    to: body.to, message: body.message,
    customer_id: body.customer_id ?? null, loan_id: body.loan_id ?? null,
  });
  res.status(201).json({ id });
}));

r.post("/email", requireRole("admin", "super_admin", "manager"), ah(async (req, res) => {
  const body = z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(10_000),
    customer_id: z.string().uuid().optional(),
    loan_id: z.string().uuid().optional(),
  }).parse(req.body);
  const id = await enqueueEmail({
    to: body.to, subject: body.subject, body: body.body,
    customer_id: body.customer_id ?? null, loan_id: body.loan_id ?? null,
  });
  res.status(201).json({ id });
}));

r.post("/in-app", requireRole("admin", "super_admin", "manager"), ah(async (req, res) => {
  const body = z.object({
    user_id: z.string().uuid(),
    title: z.string().min(1).max(255),
    body: z.string().max(2000).optional(),
    link: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
  }).parse(req.body);
  const id = await pushNotification(body);
  res.status(201).json({ id });
}));

// Force a worker drain (admin) — useful in tests / one-off retries.
r.post("/drain", requireRole("admin", "super_admin"), ah(async (_req, res) => {
  const [s, e] = await Promise.all([drainSms(stubSms), drainEmail(stubEmail)]);
  res.json({ sms: s, email: e });
}));

export default r;
