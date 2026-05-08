import { Router } from "express";
import { z } from "zod";
import { exec, query } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

r.get("/me", ah(async (req, res) => {
  const [row] = await query("SELECT * FROM profiles WHERE id = ?", [req.user!.sub]);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
}));

const SelfPatch = z.object({
  full_name: z.string().min(1).max(255).optional(),
  branch: z.string().max(255).optional().nullable(),
});

r.patch("/me", ah(async (req, res) => {
  const body = SelfPatch.parse(req.body);
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) { fields.push(`${k} = ?`); params.push(v ?? null); }
  if (!fields.length) return res.json({ ok: true });
  params.push(req.user!.sub);
  await exec(`UPDATE profiles SET ${fields.join(", ")} WHERE id = ?`, params);
  res.json({ ok: true });
}));

// Admin: list / patch any profile
r.get("/", requireRole("admin", "super_admin"), ah(async (_req, res) => {
  const rows = await query(`
    SELECT p.id, p.full_name, p.email, p.branch, p.is_active, p.mfa_required, p.created_at,
           u.is_active AS user_active, u.mfa_enrolled
      FROM profiles p
      JOIN users u ON u.id = p.id
      ORDER BY p.created_at DESC`);
  res.json(rows);
}));

const AdminPatch = z.object({
  full_name: z.string().min(1).max(255).optional(),
  branch: z.string().max(255).optional().nullable(),
  is_active: z.boolean().optional(),
  mfa_required: z.boolean().optional(),
});

r.patch("/:id", requireRole("admin", "super_admin"), ah(async (req, res) => {
  const body = AdminPatch.parse(req.body);
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    fields.push(`${k} = ?`);
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null));
  }
  if (!fields.length) return res.json({ ok: true });
  params.push(req.params.id);
  const r2 = await exec(`UPDATE profiles SET ${fields.join(", ")} WHERE id = ?`, params);
  if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });

  if (typeof body.is_active === "boolean") {
    await exec("UPDATE users SET is_active = ? WHERE id = ?", [body.is_active ? 1 : 0, req.params.id]);
  }
  await writeAudit({ userId: req.user!.sub, action: "UPDATE", table: "profiles", recordId: req.params.id, newData: body });
  res.json({ ok: true });
}));

export default r;
