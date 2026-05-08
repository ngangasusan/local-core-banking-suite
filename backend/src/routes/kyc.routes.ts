import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { exec, query } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { env } from "../env.js";
import { writeAudit } from "../services/audit.js";

const r = Router();
r.use(requireAuth);

const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR);
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp",
  "application/pdf",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^.\w-]/g, "");
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error("unsupported_file_type"));
    cb(null, true);
  },
});

// List documents for a customer
r.get("/customers/:id/documents", ah(async (req, res) => {
  const rows = await query(
    `SELECT id, doc_type, storage_path, is_id_document, uploaded_by, uploaded_at
       FROM kyc_documents WHERE customer_id = ? ORDER BY uploaded_at DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

// Upload a document — multipart/form-data: file + doc_type + is_id_document
r.post(
  "/customers/:id/documents",
  requireRole("admin", "super_admin", "manager", "loan_officer", "teller"),
  upload.single("file"),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "missing_file" });
    const docType = String(req.body.doc_type ?? "").slice(0, 100);
    if (!docType) {
      await fs.unlink(req.file.path).catch(() => undefined);
      return res.status(400).json({ error: "missing_doc_type" });
    }
    const isId = String(req.body.is_id_document ?? "false") === "true";
    const id = newId();
    await exec(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, storage_path, is_id_document, uploaded_by)
       VALUES (?,?,?,?,?,?)`,
      [id, req.params.id, docType, path.basename(req.file.path), isId ? 1 : 0, req.user!.sub]
    );
    await writeAudit({
      userId: req.user!.sub, action: "INSERT", table: "kyc_documents", recordId: id,
      newData: { customer_id: req.params.id, doc_type: docType },
    });
    res.status(201).json({ id });
  })
);

// Stream a document back. The path is stored as a basename so we can't traverse out.
r.get("/documents/:id", ah(async (req, res) => {
  const rows = await query<{ storage_path: string } & import("mysql2").RowDataPacket>(
    "SELECT storage_path FROM kyc_documents WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "not_found" });
  const filename = path.basename(row.storage_path); // defense-in-depth
  const full = path.join(UPLOAD_DIR, filename);
  try {
    await fs.access(full);
  } catch {
    return res.status(404).json({ error: "file_missing" });
  }
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  createReadStream(full).pipe(res);
}));

r.delete(
  "/documents/:id",
  requireRole("admin", "super_admin", "manager"),
  ah(async (req, res) => {
    const rows = await query<{ storage_path: string } & import("mysql2").RowDataPacket>(
      "SELECT storage_path FROM kyc_documents WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "not_found" });
    await exec("DELETE FROM kyc_documents WHERE id = ?", [req.params.id]);
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(row.storage_path))).catch(() => undefined);
    res.json({ ok: true });
  })
);

export default r;
