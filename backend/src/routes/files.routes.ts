// Object storage shim backed by the local uploads dir. Replaces the Supabase
// Storage bucket API used by KYC uploads.
//
// POST   /files/:bucket                 multipart: file, path  → { path }
// GET    /files/:bucket/signed?path=…   → { signedUrl }   (short-lived HMAC token)
// GET    /files/:bucket/object?path=…&token=…  → streams the file (no auth header needed)
// DELETE /files/:bucket?path=…

import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireAuth } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { env } from "../env.js";

const r = Router();

const ROOT = path.resolve(env.UPLOAD_DIR);
await fs.mkdir(ROOT, { recursive: true });

const safe = (bucket: string, key: string) => {
  const clean = key.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/");
  if (!clean) throw new Error("invalid_path");
  return path.join(ROOT, bucket.replace(/[^\w-]/g, ""), clean);
};

function sign(bucket: string, key: string, exp: number) {
  return createHmac("sha256", env.JWT_SECRET).update(`${bucket}:${key}:${exp}`).digest("hex");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// public (token-gated) read — must be declared before requireAuth
r.get("/:bucket/object", ah(async (req, res) => {
  const key = String(req.query.path ?? "");
  const exp = Number(req.query.exp ?? 0);
  const token = String(req.query.token ?? "");
  if (!key || !exp || Date.now() > exp) return res.status(401).json({ error: "expired" });
  const expected = sign(req.params.bucket, key, exp);
  const a = Buffer.from(token), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "bad_token" });
  const full = safe(req.params.bucket, key);
  try { await fs.access(full); } catch { return res.status(404).json({ error: "not_found" }); }
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(full)}"`);
  createReadStream(full).pipe(res);
}));

r.use(requireAuth);

r.post("/:bucket", upload.single("file"), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing_file" });
  const key = String(req.body.path ?? `${randomUUID()}${path.extname(req.file.originalname)}`);
  const full = safe(req.params.bucket, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, req.file.buffer);
  res.status(201).json({ path: key });
}));

r.get("/:bucket/signed", ah(async (req, res) => {
  const key = String(req.query.path ?? "");
  if (!key) return res.status(400).json({ error: "missing_path" });
  const ttl = Math.min(Number(req.query.expiresIn ?? 600), 86_400) * 1000;
  const exp = Date.now() + ttl;
  const token = sign(req.params.bucket, key, exp);
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    signedUrl: `${base}/files/${req.params.bucket}/object?path=${encodeURIComponent(key)}&exp=${exp}&token=${token}`,
  });
}));

r.delete("/:bucket", ah(async (req, res) => {
  const keys = String(req.query.path ?? "").split(",").filter(Boolean);
  for (const k of keys) await fs.unlink(safe(req.params.bucket, k)).catch(() => undefined);
  res.json({ ok: true });
}));

export default r;
