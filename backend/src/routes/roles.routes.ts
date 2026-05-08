import { Router } from "express";
import { z } from "zod";
import { exec, query } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

const RoleEnum = z.enum([
  "super_admin", "admin", "manager", "teller",
  "loan_officer", "finance_officer", "auditor",
]);

// List roles for a user.
r.get("/users/:id/roles", ah(async (req, res) => {
  const rows = await query("SELECT role FROM user_roles WHERE user_id = ?", [req.params.id]);
  res.json(rows.map((x) => (x as { role: string }).role));
}));

// Grant a role.
r.post("/users/:id/roles", requireRole("admin", "super_admin"),
  ah(async (req, res) => {
    const { role } = z.object({ role: RoleEnum }).parse(req.body);
    // Only super_admin can grant super_admin
    if (role === "super_admin" && !req.user!.roles.includes("super_admin"))
      return res.status(403).json({ error: "forbidden" });
    try {
      await exec("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
        [newId(), req.params.id, role]);
    } catch (e) {
      if ((e as { code?: string }).code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "already_granted" });
      if ((e as { code?: string }).code === "ER_NO_REFERENCED_ROW_2")
        return res.status(404).json({ error: "user_not_found" });
      throw e;
    }
    await writeAudit({ userId: req.user!.sub, action: "INSERT", table: "user_roles", recordId: req.params.id, newData: { role } });
    res.status(201).json({ ok: true });
  }));

// Revoke a role.
r.delete("/users/:id/roles/:role", requireRole("admin", "super_admin"),
  ah(async (req, res) => {
    const role = RoleEnum.parse(req.params.role);
    if (role === "super_admin" && !req.user!.roles.includes("super_admin"))
      return res.status(403).json({ error: "forbidden" });
    // prevent removing the last super_admin
    if (role === "super_admin") {
      const rows = await query<{ n: number } & import("mysql2").RowDataPacket>(
        "SELECT COUNT(*) AS n FROM user_roles WHERE role = 'super_admin'"
      );
      if ((rows[0]?.n ?? 0) <= 1) return res.status(409).json({ error: "last_super_admin" });
    }
    const r2 = await exec("DELETE FROM user_roles WHERE user_id = ? AND role = ?",
      [req.params.id, role]);
    if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    await writeAudit({ userId: req.user!.sub, action: "DELETE", table: "user_roles", recordId: req.params.id, newData: { role } });
    res.json({ ok: true });
  }));

// ----- Permissions catalog -----
r.get("/permissions", ah(async (_req, res) => {
  const rows = await query(
    "SELECT id, code, description, category FROM permissions ORDER BY category, code"
  );
  res.json(rows);
}));

const PermBody = z.object({
  code: z.string().min(1).max(100).regex(/^[a-z0-9_.:-]+$/),
  description: z.string().max(500).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
});

r.post("/permissions", requireRole("super_admin"), ah(async (req, res) => {
  const body = PermBody.parse(req.body);
  const id = newId();
  try {
    await exec(
      "INSERT INTO permissions (id, code, description, category) VALUES (?,?,?,?)",
      [id, body.code, body.description ?? null, body.category ?? null]
    );
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "code_taken" });
    throw e;
  }
  res.status(201).json({ id });
}));

// Role <-> permission mapping
r.get("/permissions/role/:role", ah(async (req, res) => {
  const role = RoleEnum.parse(req.params.role);
  const rows = await query(
    `SELECT p.id, p.code, p.description, p.category
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role = ?
      ORDER BY p.category, p.code`,
    [role]
  );
  res.json(rows);
}));

r.post("/permissions/role/:role", requireRole("super_admin"), ah(async (req, res) => {
  const role = RoleEnum.parse(req.params.role);
  const { permission_id } = z.object({ permission_id: z.string().uuid() }).parse(req.body);
  try {
    await exec(
      "INSERT INTO role_permissions (id, role, permission_id) VALUES (?,?,?)",
      [newId(), role, permission_id]
    );
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "already_granted" });
    if ((e as { code?: string }).code === "ER_NO_REFERENCED_ROW_2")
      return res.status(404).json({ error: "permission_not_found" });
    throw e;
  }
  res.status(201).json({ ok: true });
}));

r.delete("/permissions/role/:role/:permission_id",
  requireRole("super_admin"), ah(async (req, res) => {
    const role = RoleEnum.parse(req.params.role);
    const r2 = await exec(
      "DELETE FROM role_permissions WHERE role = ? AND permission_id = ?",
      [role, req.params.permission_id]
    );
    if (r2.affectedRows === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  }));

export default r;
