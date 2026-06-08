import { Router } from "express";
import { z } from "zod";
import { query, exec, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole, requireMfa } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { ListQuery, pageLimits } from "../util/listing.js";
import { newId } from "../util/uuid.js";
import { writeAudit, verifyAuditChain } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

// -------- Chart of accounts --------
r.get("/coa", ah(async (_req, res) => {
  const rows = await query(
    "SELECT id, code, name, account_class, is_active FROM chart_of_accounts ORDER BY code"
  );
  res.json({ rows });
}));

const CoaBody = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(255),
  account_class: z.enum(["asset", "liability", "equity", "income", "expense"]),
  is_active: z.boolean().default(true),
});

// COA edits are a privileged action — admin + MFA, like the legacy policy.
r.post("/coa", requireRole("admin", "super_admin"), requireMfa, ah(async (req, res) => {
  const body = CoaBody.parse(req.body);
  const id = newId();
  try {
    await exec(
      `INSERT INTO chart_of_accounts (id, code, name, account_class, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [id, body.code, body.name, body.account_class, body.is_active ? 1 : 0]
    );
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "code_taken" });
    throw e;
  }
  await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "chart_of_accounts", recordId: id, newData: body });
  res.status(201).json({ id });
}));

// -------- Journal entries --------
r.get("/journal", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const where: string[] = [];
  const params: unknown[] = [];
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (from) { where.push("j.entry_date >= ?"); params.push(from); }
  if (to)   { where.push("j.entry_date <= ?"); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT j.id, j.entry_date, j.reference, j.description, j.amount,
            j.source_table, j.source_id, j.created_at,
            dr.code AS debit_code,  dr.name AS debit_name,
            cr.code AS credit_code, cr.name AS credit_name
       FROM journal_entries j
       JOIN chart_of_accounts dr ON dr.id = j.debit_account
       JOIN chart_of_accounts cr ON cr.id = j.credit_account
       ${whereSql}
       ORDER BY j.entry_date DESC, j.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM journal_entries j ${whereSql}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

// Trial balance — sum debits/credits per account; assets/expenses are debit-normal.
r.get("/trial-balance", ah(async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  const whereD: string[] = ["debit_account IS NOT NULL"];
  const whereC: string[] = ["credit_account IS NOT NULL"];
  const params: unknown[] = [];
  if (from) { whereD.push("entry_date >= ?"); whereC.push("entry_date >= ?"); params.push(from); }
  if (to)   { whereD.push("entry_date <= ?"); whereC.push("entry_date <= ?"); params.push(to); }
  const rows = await query(
    `SELECT coa.id, coa.code, coa.name, coa.account_class,
            COALESCE(d.total, 0) AS debit_total,
            COALESCE(c.total, 0) AS credit_total
       FROM chart_of_accounts coa
       LEFT JOIN (
         SELECT debit_account AS acc, SUM(amount) AS total
           FROM journal_entries WHERE ${whereD.join(" AND ")}
           GROUP BY debit_account
       ) d ON d.acc = coa.id
       LEFT JOIN (
         SELECT credit_account AS acc, SUM(amount) AS total
           FROM journal_entries WHERE ${whereC.join(" AND ")}
           GROUP BY credit_account
       ) c ON c.acc = coa.id
       ORDER BY coa.code`,
    [...params, ...params]
  );
  res.json({ rows });
}));

// -------- Audit chain --------
r.get("/audit", requireRole("admin", "super_admin", "auditor"), ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const { limit, offset } = pageLimits(q);
  const rows = await query(
    `SELECT seq, id, user_id, action, table_name, record_id, created_at
       FROM audit_log
       ORDER BY seq DESC
       LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({ rows });
}));

r.get("/audit/verify", requireRole("admin", "super_admin", "auditor"),
  ah(async (_req, res) => res.json(await verifyAuditChain())));

export default r;
