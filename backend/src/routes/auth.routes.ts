import { Router } from "express";
import { z } from "zod";
import { exec, query, tx, type RowDataPacket } from "../db.js";
import { hashPassword, verifyPassword } from "../auth/bcrypt.js";
import { signAccess, signRefresh, verifyRefresh, type AppRole } from "../auth/jwt.js";
import { buildOtpauthUrl, buildQrDataUrl, generateMfaSecret, verifyMfaToken } from "../auth/mfa.js";
import { requireAuth } from "../auth/middleware.js";
import { newId } from "../util/uuid.js";
import { ah } from "../util/asyncRoute.js";
import { env } from "../env.js";

const r = Router();

interface UserRow extends RowDataPacket {
  id: string; email: string; full_name: string;
  password_hash: string;
  mfa_secret: string | null;
  mfa_enrolled: 0 | 1;
  is_active: 0 | 1;
}

async function loadRoles(userId: string): Promise<AppRole[]> {
  const rows = await query<RowDataPacket & { role: AppRole }>(
    "SELECT role FROM user_roles WHERE user_id = ?", [userId]
  );
  return rows.map((x) => x.role);
}

const REFRESH_COOKIE = "rt";
const cookieOpts = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/auth",
};

const LoginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

r.post("/login", ah(async (req, res) => {
  const body = LoginBody.parse(req.body);
  const [u] = await query<UserRow>(
    "SELECT id, email, full_name, password_hash, mfa_secret, mfa_enrolled, is_active FROM users WHERE email = ? LIMIT 1",
    [body.email.toLowerCase()]
  );
  if (!u || !u.is_active) return res.status(401).json({ error: "invalid_credentials" });
  if (!(await verifyPassword(body.password, u.password_hash)))
    return res.status(401).json({ error: "invalid_credentials" });

  const roles = await loadRoles(u.id);

  if (u.mfa_enrolled && u.mfa_secret) {
    // MFA challenge — issue a short pre-auth token only valid for /mfa/verify
    const preAuth = signAccess({ sub: u.id, email: u.email, roles, mfa: false });
    return res.json({ mfa_required: true, pre_auth_token: preAuth });
  }

  const access = signAccess({ sub: u.id, email: u.email, roles, mfa: false });
  const jti = newId();
  await exec("INSERT INTO refresh_tokens (jti, user_id, created_at) VALUES (?, ?, NOW())", [jti, u.id]);
  const refresh = signRefresh({ sub: u.id, jti });
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts);
  return res.json({ access_token: access, user: { id: u.id, email: u.email, full_name: u.full_name, roles } });
}));

const MfaVerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });

r.post("/mfa/verify", requireAuth, ah(async (req, res) => {
  const body = MfaVerifyBody.parse(req.body);
  const uid = req.user!.sub;
  const [u] = await query<UserRow>("SELECT id, email, full_name, mfa_secret, mfa_enrolled FROM users WHERE id = ?", [uid]);
  if (!u || !u.mfa_secret) return res.status(400).json({ error: "mfa_not_enrolled" });
  if (!verifyMfaToken(body.code, u.mfa_secret)) return res.status(401).json({ error: "invalid_code" });

  const roles = await loadRoles(u.id);
  const access = signAccess({ sub: u.id, email: u.email, roles, mfa: true });
  const jti = newId();
  await exec("INSERT INTO refresh_tokens (jti, user_id, mfa, created_at) VALUES (?, ?, 1, NOW())", [jti, u.id]);
  const refresh = signRefresh({ sub: u.id, jti });
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts);
  return res.json({ access_token: access, user: { id: u.id, email: u.email, full_name: u.full_name, roles } });
}));

r.post("/mfa/enroll/start", requireAuth, ah(async (req, res) => {
  const secret = generateMfaSecret();
  // Stash candidate secret on the user row but don't mark enrolled until verified
  await exec("UPDATE users SET mfa_secret = ?, mfa_enrolled = 0 WHERE id = ?", [secret, req.user!.sub]);
  const url = buildOtpauthUrl(req.user!.email, secret);
  const qr = await buildQrDataUrl(url);
  return res.json({ secret, otpauth_url: url, qr_code: qr });
}));

r.post("/mfa/enroll/finish", requireAuth, ah(async (req, res) => {
  const body = MfaVerifyBody.parse(req.body);
  const [u] = await query<UserRow>("SELECT mfa_secret FROM users WHERE id = ?", [req.user!.sub]);
  if (!u?.mfa_secret) return res.status(400).json({ error: "no_pending_enrollment" });
  if (!verifyMfaToken(body.code, u.mfa_secret)) return res.status(401).json({ error: "invalid_code" });
  await exec("UPDATE users SET mfa_enrolled = 1 WHERE id = ?", [req.user!.sub]);
  return res.json({ ok: true });
}));

r.post("/mfa/disable", requireAuth, ah(async (req, res) => {
  await exec("UPDATE users SET mfa_secret = NULL, mfa_enrolled = 0 WHERE id = ?", [req.user!.sub]);
  return res.json({ ok: true });
}));

r.post("/refresh", ah(async (req, res) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? "";
  if (!token) return res.status(401).json({ error: "missing_refresh" });
  let claims;
  try { claims = verifyRefresh(token); } catch { return res.status(401).json({ error: "invalid_refresh" }); }

  // rotation: confirm jti is still valid, then revoke and issue a new one
  const result = await tx(async (cx) => {
    const [rows] = await cx.query<RowDataPacket[]>(
      "SELECT user_id, mfa, revoked_at FROM refresh_tokens WHERE jti = ? LIMIT 1", [claims.jti]
    );
    const row = rows[0];
    if (!row || row.revoked_at) return null;
    await cx.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = ?", [claims.jti]);
    const newJti = newId();
    await cx.query("INSERT INTO refresh_tokens (jti, user_id, mfa, created_at) VALUES (?, ?, ?, NOW())",
      [newJti, claims.sub, row.mfa ? 1 : 0]);
    return { newJti, mfa: !!row.mfa };
  });
  if (!result) return res.status(401).json({ error: "refresh_revoked" });

  const [u] = await query<UserRow>("SELECT id, email, full_name FROM users WHERE id = ?", [claims.sub]);
  if (!u) return res.status(401).json({ error: "user_gone" });
  const roles = await loadRoles(u.id);
  const access = signAccess({ sub: u.id, email: u.email, roles, mfa: result.mfa });
  const refresh = signRefresh({ sub: u.id, jti: result.newJti });
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts);
  return res.json({ access_token: access, user: { id: u.id, email: u.email, full_name: u.full_name, roles } });
}));

r.post("/logout", ah(async (req, res) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? "";
  if (token) {
    try {
      const c = verifyRefresh(token);
      await exec("UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = ? AND revoked_at IS NULL", [c.jti]);
    } catch { /* ignore */ }
  }
  res.clearCookie(REFRESH_COOKIE, cookieOpts);
  return res.json({ ok: true });
}));

r.get("/me", requireAuth, ah(async (req, res) => {
  const [u] = await query<UserRow>("SELECT id, email, full_name, mfa_enrolled FROM users WHERE id = ?", [req.user!.sub]);
  if (!u) return res.status(404).json({ error: "not_found" });
  const roles = await loadRoles(u.id);
  return res.json({
    id: u.id, email: u.email, full_name: u.full_name,
    mfa_enrolled: !!u.mfa_enrolled, mfa: req.user!.mfa, roles,
  });
}));

// ---- Admin: create users ----
const RoleEnum = z.enum([
  "super_admin","admin","manager","teller","loan_officer","finance_officer","auditor"
]);
const CreateUserBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  full_name: z.string().min(1).max(255),
  role: RoleEnum,
});

r.post("/users", requireAuth, ah(async (req, res) => {
  const roles = req.user!.roles;
  if (!roles.includes("super_admin") && !roles.includes("admin"))
    return res.status(403).json({ error: "forbidden" });

  const body = CreateUserBody.parse(req.body);
  const id = newId();
  const hash = await hashPassword(body.password);
  try {
    await tx(async (cx) => {
      await cx.query(
        "INSERT INTO users (id, email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?, 1)",
        [id, body.email.toLowerCase(), body.full_name, hash]
      );
      await cx.query("INSERT INTO profiles (id, full_name, email) VALUES (?, ?, ?)",
        [id, body.full_name, body.email.toLowerCase()]);
      await cx.query("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)",
        [newId(), id, body.role]);
    });
  } catch (e: unknown) {
    const msg = (e as { code?: string }).code === "ER_DUP_ENTRY" ? "email_taken" : "create_failed";
    return res.status(400).json({ error: msg });
  }
  return res.status(201).json({ id });
}));

// ---- Bootstrap: very first user becomes super_admin ----
const BootstrapBody = CreateUserBody.omit({ role: true });
r.post("/bootstrap", ah(async (req, res) => {
  const [c] = await query<RowDataPacket & { n: number }>("SELECT COUNT(*) AS n FROM users");
  if (c && c.n > 0) return res.status(409).json({ error: "already_bootstrapped" });
  const body = BootstrapBody.parse(req.body);
  const id = newId();
  const hash = await hashPassword(body.password);
  await tx(async (cx) => {
    await cx.query("INSERT INTO users (id, email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?, 1)",
      [id, body.email.toLowerCase(), body.full_name, hash]);
    await cx.query("INSERT INTO profiles (id, full_name, email) VALUES (?, ?, ?)",
      [id, body.full_name, body.email.toLowerCase()]);
    await cx.query("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, 'super_admin')",
      [newId(), id]);
  });
  return res.status(201).json({ id });
}));

export default r;
