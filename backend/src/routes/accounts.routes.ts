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

const AccountBody = z.object({
  account_number: z.string().min(1).max(50),
  account_type: z.enum(["savings", "current", "loan", "wallet"]),
  customer_id: z.string().uuid(),
  currency: z.string().min(2).max(8).default("KES"),
  interest_rate: z.coerce.number().min(0).max(1).optional().default(0),
  status: z.enum(["active", "dormant", "closed", "frozen"]).default("active"),
});

const SORTABLE = ["created_at", "account_number", "balance", "status"] as const;

r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const customer_id = typeof req.query.customer_id === "string" ? req.query.customer_id : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q) { where.push("(a.account_number LIKE ? OR c.full_name LIKE ?)"); const l = `%${q.q}%`; params.push(l, l); }
  if (customer_id) { where.push("a.customer_id = ?"); params.push(customer_id); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { limit, offset } = pageLimits(q);

  const rows = await query(
    `SELECT a.id, a.account_number, a.account_type, a.customer_id, c.full_name AS customer_name,
            a.currency, a.balance, a.interest_rate, a.status, a.opened_at, a.created_at
       FROM accounts a
       JOIN customers c ON c.id = a.customer_id
       ${whereSql}
       ${safeOrderBy(q, SORTABLE, "created_at").replace(/ORDER BY (\w+)/, (_m, c1) => `ORDER BY a.${c1}`)}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM accounts a JOIN customers c ON c.id = a.customer_id ${whereSql}`,
    params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.get("/:id", ah(async (req, res) => {
  const [row] = await query("SELECT * FROM accounts WHERE id = ? LIMIT 1", [req.params.id]);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
}));

r.post("/", requireRole("admin", "super_admin", "manager", "teller"),
  ah(async (req, res) => {
    const body = AccountBody.parse(req.body);
    const id = newId();
    try {
      await exec(
        `INSERT INTO accounts (id, account_number, account_type, customer_id, currency, interest_rate, status)
         VALUES (?,?,?,?,?,?,?)`,
        [id, body.account_number, body.account_type, body.customer_id, body.currency, body.interest_rate, body.status]
      );
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "account_number_taken" });
      if ((e as { code?: string }).code === "ER_NO_REFERENCED_ROW_2")
        return res.status(400).json({ error: "customer_not_found" });
      throw e;
    }
    await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "accounts", recordId: id, newData: { ...body, id } });
    res.status(201).json({ id });
  }));

const PatchBody = AccountBody.pick({
  status: true, currency: true, interest_rate: true,
}).partial();

r.patch("/:id", requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const body = PatchBody.parse(req.body);
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) { fields.push(`${k} = ?`); params.push(v); }
    if (fields.length === 0) return res.json({ ok: true });
    params.push(req.params.id);
    const r2 = await exec(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`, params);
    if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    await writeAudit({ userId: req.user!.sub, action: "UPDATE", table: "accounts", recordId: req.params.id, newData: body });
    res.json({ ok: true });
  }));

export default r;
