import { Router } from "express";
import { z } from "zod";
import { exec, query, tx, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { ListQuery, pageLimits, safeOrderBy } from "../util/listing.js";
import { encryptPII } from "../services/pii.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

const CustomerBody = z.object({
  customer_number: z.string().min(1).max(50),
  customer_type: z.enum(["individual", "business"]).default("individual"),
  full_name: z.string().min(1).max(255),
  national_id: z.string().max(50).optional().nullable(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(2000).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).default("Kenya"),
  occupation: z.string().max(255).optional().nullable(),
  employer: z.string().max(255).optional().nullable(),
  monthly_income: z.coerce.number().nonnegative().optional().nullable(),
});

const SORTABLE = ["created_at", "full_name", "customer_number", "kyc_status"] as const;

r.get("/", ah(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.q) {
    where.push("(full_name LIKE ? OR customer_number LIKE ? OR phone LIKE ?)");
    const like = `%${q.q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { limit, offset } = pageLimits(q);

  const rows = await query(
    `SELECT id, customer_number, customer_type, full_name, phone, email,
            kyc_status, credit_score, is_active, created_at
       FROM customers ${whereSql}
       ${safeOrderBy(q, SORTABLE, "created_at")}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [c] = await query<RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM customers ${whereSql}`, params
  );
  res.json({ rows, total: c?.n ?? 0, limit, offset });
}));

r.get("/:id", ah(async (req, res) => {
  const [row] = await query("SELECT * FROM customers WHERE id = ? LIMIT 1", [req.params.id]);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
}));

r.post("/", requireRole("admin", "super_admin", "manager", "loan_officer", "teller"),
  ah(async (req, res) => {
    const body = CustomerBody.parse(req.body);
    const id = newId();
    try {
      await tx(async (cx) => {
        await cx.query(
          `INSERT INTO customers
           (id, customer_number, customer_type, full_name, national_id, date_of_birth,
            email, phone, address, city, country, occupation, employer, monthly_income, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, body.customer_number, body.customer_type, body.full_name,
           body.national_id ?? null, body.date_of_birth ?? null,
           body.email ?? null, body.phone ?? null, body.address ?? null,
           body.city ?? null, body.country, body.occupation ?? null,
           body.employer ?? null, body.monthly_income ?? null, req.user!.sub]
        );
        // PII vault — encrypted copies
        await cx.query(
          `INSERT INTO customer_pii_vault (customer_id, national_id_enc, phone_enc, email_enc, dob_enc)
           VALUES (?, ?, ?, ?, ?)`,
          [id, encryptPII(body.national_id ?? null), encryptPII(body.phone ?? null),
           encryptPII(body.email ?? null), encryptPII(body.date_of_birth ?? null)]
        );
      });
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "customer_number_taken" });
      throw e;
    }
    await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "customers", recordId: id, newData: { ...body, id } });
    res.status(201).json({ id });
  }));

const PatchBody = CustomerBody.partial();

r.patch("/:id", requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    const body = PatchBody.parse(req.body);
    const [old] = await query("SELECT * FROM customers WHERE id = ?", [req.params.id]);
    if (!old) return res.status(404).json({ error: "not_found" });

    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      fields.push(`${k} = ?`);
      params.push(v ?? null);
    }
    if (fields.length === 0) return res.json({ ok: true });
    params.push(req.params.id);
    await exec(`UPDATE customers SET ${fields.join(", ")} WHERE id = ?`, params);

    // Sync PII vault if any PII column changed
    const pii = body as Record<string, unknown>;
    if ("national_id" in pii || "phone" in pii || "email" in pii || "date_of_birth" in pii) {
      await exec(
        `UPDATE customer_pii_vault
            SET national_id_enc = COALESCE(?, national_id_enc),
                phone_enc       = COALESCE(?, phone_enc),
                email_enc       = COALESCE(?, email_enc),
                dob_enc         = COALESCE(?, dob_enc)
          WHERE customer_id = ?`,
        [
          "national_id" in pii ? encryptPII(pii.national_id as string | null) : null,
          "phone" in pii ? encryptPII(pii.phone as string | null) : null,
          "email" in pii ? encryptPII(pii.email as string | null) : null,
          "date_of_birth" in pii ? encryptPII(pii.date_of_birth as string | null) : null,
          req.params.id,
        ]
      );
    }
    await writeAudit({ userId: req.user!.sub, action: "UPDATE", table: "customers", recordId: req.params.id, oldData: old, newData: body });
    res.json({ ok: true });
  }));

// ----- KYC verification (manager+) -----
const KycBody = z.object({
  status: z.enum(["submitted", "verified", "rejected"]),
  notes: z.string().max(2000).optional(),
  rejection_reason: z.string().max(2000).optional(),
});

r.post("/:id/kyc", requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const body = KycBody.parse(req.body);
    const fields: string[] = ["kyc_status = ?", "kyc_notes = ?"];
    const params: unknown[] = [body.status, body.notes ?? null];
    if (body.status === "submitted") {
      fields.push("kyc_submitted_by = ?", "kyc_submitted_at = NOW(3)");
      params.push(req.user!.sub);
    } else if (body.status === "verified") {
      fields.push("kyc_verified_by = ?", "kyc_verified_at = NOW(3)", "kyc_rejection_reason = NULL");
      params.push(req.user!.sub);
    } else {
      fields.push("kyc_rejection_reason = ?");
      params.push(body.rejection_reason ?? body.notes ?? "rejected");
    }
    params.push(req.params.id);
    const r2 = await exec(`UPDATE customers SET ${fields.join(", ")} WHERE id = ?`, params);
    if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    await writeAudit({ userId: req.user!.sub, action: "UPDATE", table: "customers", recordId: req.params.id, newData: { kyc: body } });
    res.json({ ok: true });
  }));

// ----- Guarantors -----
const GuarantorBody = z.object({
  full_name: z.string().min(1).max(255),
  national_id: z.string().min(1).max(50),
  phone: z.string().min(1).max(50),
  email: z.string().email().max(255).optional().nullable(),
  relationship: z.string().max(100).optional().nullable(),
  address: z.string().max(2000).optional().nullable(),
  occupation: z.string().max(255).optional().nullable(),
  monthly_income: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

r.get("/:id/guarantors", ah(async (req, res) => {
  const rows = await query(
    "SELECT * FROM guarantors WHERE customer_id = ? ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(rows);
}));

r.post("/:id/guarantors", requireRole("admin", "super_admin", "manager", "loan_officer"),
  ah(async (req, res) => {
    const body = GuarantorBody.parse(req.body);
    const id = newId();
    await exec(
      `INSERT INTO guarantors
       (id, customer_id, full_name, national_id, phone, email, relationship, address, occupation, monthly_income, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.params.id, body.full_name, body.national_id, body.phone, body.email ?? null,
       body.relationship ?? null, body.address ?? null, body.occupation ?? null,
       body.monthly_income ?? null, body.notes ?? null, req.user!.sub]
    );
    res.status(201).json({ id });
  }));

r.delete("/:id/guarantors/:gid", requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const r2 = await exec("DELETE FROM guarantors WHERE id = ? AND customer_id = ?", [req.params.gid, req.params.id]);
    if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  }));

export default r;
