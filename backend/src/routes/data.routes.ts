// Generic MySQL data API — a small PostgREST-compatible subset that backs the
// frontend `sql` client (src/lib/sql-client.ts). It replaces the Supabase Data
// API so the UI can talk to MySQL with the same query shape it used before.
//
// GET    /data/:table?select=...&col=eq.x&order=col.desc&limit=10&count=exact
// POST   /data/:table            body: object | object[]   (?select=... to return rows)
// PATCH  /data/:table?filters    body: object
// DELETE /data/:table?filters
//
// Everything is parameterised; identifiers are validated against
// information_schema so no user string ever reaches the SQL text unescaped.

import { Router } from "express";
import { query, exec, pool, type RowDataPacket } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";

const r = Router();
r.use(requireAuth);

/* ------------------------------------------------------------------ */
/* schema metadata                                                     */
/* ------------------------------------------------------------------ */

type Fk = { name: string; table: string; column: string; refTable: string; refColumn: string };

let metaCache: { cols: Map<string, Set<string>>; fks: Fk[] } | null = null;

async function meta() {
  if (metaCache) return metaCache;
  const cols = new Map<string, Set<string>>();
  const colRows = await query<RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string }>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  for (const c of colRows) {
    if (!cols.has(c.TABLE_NAME)) cols.set(c.TABLE_NAME, new Set());
    cols.get(c.TABLE_NAME)!.add(c.COLUMN_NAME);
  }
  const fkRows = await query<
    RowDataPacket & {
      CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string;
      REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string;
    }
  >(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  const fks: Fk[] = fkRows.map((f) => ({
    name: f.CONSTRAINT_NAME,
    table: f.TABLE_NAME,
    column: f.COLUMN_NAME,
    refTable: f.REFERENCED_TABLE_NAME,
    refColumn: f.REFERENCED_COLUMN_NAME,
  }));
  metaCache = { cols, fks };
  return metaCache;
}

/** Tables the browser may never touch at all. */
const BLOCKED = new Set(["users", "refresh_tokens", "schema_migrations", "customer_pii_vault"]);
/** Tables that are read-only through this endpoint (writes go through domain routes). */
const READ_ONLY = new Set(["audit_log", "loan_provisions", "journal_entries", "transactions"]);

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function assertTable(t: string) {
  const m = await meta();
  if (BLOCKED.has(t) || !m.cols.has(t)) throw new HttpError(404, `unknown_table:${t}`);
  return m;
}

function assertCol(m: Awaited<ReturnType<typeof meta>>, table: string, col: string) {
  if (!m.cols.get(table)?.has(col)) throw new HttpError(400, `unknown_column:${table}.${col}`);
  return col;
}

const q = (id: string) => `\`${id.replace(/`/g, "")}\``;

/* ------------------------------------------------------------------ */
/* select parsing                                                      */
/* ------------------------------------------------------------------ */

type Embed = { alias: string; table: string; fk?: string; select: string };
type Parsed = { columns: { alias: string; col: string }[]; star: boolean; embeds: Embed[] };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseSelect(sel: string): Parsed {
  const parsed: Parsed = { columns: [], star: false, embeds: [] };
  for (const item of splitTop(sel || "*")) {
    const paren = item.indexOf("(");
    if (paren === -1) {
      if (item === "*") { parsed.star = true; continue; }
      const [a, b] = item.split(":");
      parsed.columns.push(b ? { alias: a.trim(), col: b.trim() } : { alias: a.trim(), col: a.trim() });
      continue;
    }
    const head = item.slice(0, paren).trim();
    const body = item.slice(paren + 1, item.lastIndexOf(")"));
    let alias = head, target = head;
    if (head.includes(":")) {
      const [a, t] = head.split(":");
      alias = a.trim(); target = t.trim();
    }
    let table = target, fk: string | undefined;
    if (target.includes("!")) {
      const [t, f] = target.split("!");
      table = t.trim(); fk = f.trim();
    }
    parsed.embeds.push({ alias, table, fk, select: body });
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* filters                                                             */
/* ------------------------------------------------------------------ */

const RESERVED = new Set(["select", "order", "limit", "offset", "count", "head", "or"]);

const ISO_DT_FILTER = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
function coerce(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (ISO_DT_FILTER.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 23).replace("T", " ");
  }
  return raw;
}

function opClause(m: Awaited<ReturnType<typeof meta>>, table: string, col: string, expr: string,
                  params: unknown[]): string {
  assertCol(m, table, col);
  const dot = expr.indexOf(".");
  const op = dot === -1 ? "eq" : expr.slice(0, dot);
  const raw = dot === -1 ? expr : expr.slice(dot + 1);
  const c = `${q(table)}.${q(col)}`;
  switch (op) {
    case "eq": params.push(coerce(raw)); return `${c} <=> ?`;
    case "neq": params.push(coerce(raw)); return `NOT (${c} <=> ?)`;
    case "gt": params.push(coerce(raw)); return `${c} > ?`;
    case "gte": params.push(coerce(raw)); return `${c} >= ?`;
    case "lt": params.push(coerce(raw)); return `${c} < ?`;
    case "lte": params.push(coerce(raw)); return `${c} <= ?`;
    case "like": params.push(raw); return `${c} LIKE ?`;
    case "ilike": params.push(raw); return `LOWER(${c}) LIKE LOWER(?)`;
    case "is": return raw === "null" ? `${c} IS NULL` : (params.push(raw === "true" ? 1 : 0), `${c} = ?`);
    case "in": {
      const list = raw.replace(/^\(/, "").replace(/\)$/, "");
      const vals = splitTop(list).map((v) => v.replace(/^"|"$/g, ""));
      if (!vals.length) return "1 = 0";
      vals.forEach((v) => params.push(coerce(v)));
      return `${c} IN (${vals.map(() => "?").join(",")})`;
    }
    case "not": {
      // not.is.null / not.eq.x
      return `NOT (${opClause(m, table, col, raw, params)})`;
    }
    default: throw new HttpError(400, `unsupported_operator:${op}`);
  }
}

function buildWhere(m: Awaited<ReturnType<typeof meta>>, table: string,
                    qs: Record<string, unknown>, params: unknown[]): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(qs)) {
    if (RESERVED.has(key)) continue;
    const vals = Array.isArray(value) ? value : [value];
    for (const v of vals) parts.push(opClause(m, table, key, String(v), params));
  }
  const or = qs.or;
  if (typeof or === "string") {
    const inner = or.replace(/^\(/, "").replace(/\)$/, "");
    const branches = splitTop(inner).map((b) => {
      const i = b.indexOf(".");
      const col = b.slice(0, i);
      return opClause(m, table, col, b.slice(i + 1), params);
    });
    if (branches.length) parts.push(`(${branches.join(" OR ")})`);
  }
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

function buildOrder(m: Awaited<ReturnType<typeof meta>>, table: string, order: unknown): string {
  if (!order) return "";
  const items = (Array.isArray(order) ? order : [order]).map(String);
  const parts = items.map((it) => {
    const [col, ...rest] = it.split(".");
    assertCol(m, table, col);
    const dir = rest.includes("desc") ? "DESC" : "ASC";
    const nulls = rest.includes("nullsfirst") ? "IS NOT NULL, " : rest.includes("nullslast") ? "IS NULL, " : "";
    return nulls
      ? `${q(table)}.${q(col)} ${nulls.trim().replace(/,$/, "")}, ${q(table)}.${q(col)} ${dir}`
      : `${q(table)}.${q(col)} ${dir}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* read                                                                */
/* ------------------------------------------------------------------ */

function projection(m: Awaited<ReturnType<typeof meta>>, table: string, p: Parsed): string {
  if (p.star || p.columns.length === 0) return `${q(table)}.*`;
  const cols = p.columns.map((c) => `${q(table)}.${q(assertCol(m, table, c.col))} AS ${q(c.alias)}`);
  // embeds need their join keys available
  return cols.join(", ");
}

async function hydrateEmbeds(table: string, rows: Record<string, unknown>[], embeds: Embed[]) {
  if (!rows.length || !embeds.length) return;
  const m = await meta();
  for (const em of embeds) {
    if (!m.cols.has(em.table) || BLOCKED.has(em.table)) throw new HttpError(400, `unknown_table:${em.table}`);
    const candidates = m.fks.filter(
      (f) =>
        (f.table === table && f.refTable === em.table) ||
        (f.table === em.table && f.refTable === table)
    );
    const fk = em.fk ? candidates.find((f) => f.name === em.fk) ?? candidates[0] : candidates[0];
    if (!fk) throw new HttpError(400, `no_relation:${table}->${em.table}`);

    const sub = parseSelect(em.select);
    const toOne = fk.table === table;
    const localCol = toOne ? fk.column : fk.refColumn;   // column on base rows
    const remoteCol = toOne ? fk.refColumn : fk.column;  // column on embed rows

    const keys = [...new Set(rows.map((row) => row[localCol]).filter((v) => v !== null && v !== undefined))];
    if (!keys.length) {
      for (const row of rows) row[em.alias] = toOne ? null : [];
      continue;
    }

    const cols = sub.star || !sub.columns.length
      ? `${q(em.table)}.*`
      : [...new Set([...sub.columns.map((c) => `${q(em.table)}.${q(assertCol(m, em.table, c.col))} AS ${q(c.alias)}`),
                     `${q(em.table)}.${q(remoteCol)} AS ${q("__key")}`])].join(", ");
    const sqlText =
      `SELECT ${cols}${sub.star ? "" : ""} FROM ${q(em.table)} WHERE ${q(em.table)}.${q(remoteCol)} IN (${keys.map(() => "?").join(",")})`;
    const sub_rows = await query<RowDataPacket>(sqlText, keys as unknown[]);
    const plain = sub_rows.map((x) => ({ ...x })) as Record<string, unknown>[];

    await hydrateEmbeds(em.table, plain, sub.embeds);

    const byKey = new Map<string, Record<string, unknown>[]>();
    for (const rrow of plain) {
      const k = String(rrow["__key"] ?? rrow[remoteCol]);
      delete rrow["__key"];
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(rrow);
    }
    for (const row of rows) {
      const list = byKey.get(String(row[localCol])) ?? [];
      row[em.alias] = toOne ? (list[0] ?? null) : list;
    }
  }
}

r.get("/:table", ah(async (req, res) => {
  const table = req.params.table;
  const m = await assertTable(table);
  const qs = req.query as Record<string, unknown>;
  const parsed = parseSelect(String(qs.select ?? "*"));

  const params: unknown[] = [];
  const where = buildWhere(m, table, qs, params);
  const order = buildOrder(m, table, qs.order);
  const limit = qs.limit ? Math.min(Number(qs.limit), 5000) : null;
  const offset = qs.offset ? Number(qs.offset) : 0;

  let count: number | null = null;
  if (qs.count === "exact") {
    const cparams: unknown[] = [];
    const cwhere = buildWhere(m, table, qs, cparams);
    const [c] = await query<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM ${q(table)} ${cwhere}`, cparams
    );
    count = Number(c?.n ?? 0);
  }
  if (qs.head === "true") return res.json({ rows: [], count });

  // make sure embed join keys are selected
  const extra: string[] = [];
  for (const em of parsed.embeds) {
    const candidates = m.fks.filter(
      (f) => (f.table === table && f.refTable === em.table) || (f.table === em.table && f.refTable === table)
    );
    const fk = em.fk ? candidates.find((f) => f.name === em.fk) ?? candidates[0] : candidates[0];
    if (fk) {
      const localCol = fk.table === table ? fk.column : fk.refColumn;
      extra.push(`${q(table)}.${q(localCol)} AS ${q(localCol)}`);
    }
  }
  const proj = [projection(m, table, parsed), ...extra].join(", ");

  const sqlText = `SELECT ${proj} FROM ${q(table)} ${where} ${order}` +
    (limit !== null ? ` LIMIT ${limit} OFFSET ${offset}` : offset ? ` LIMIT 18446744073709551615 OFFSET ${offset}` : "");
  const rows = (await query<RowDataPacket>(sqlText, params)).map((x) => ({ ...x })) as Record<string, unknown>[];
  await hydrateEmbeds(table, rows, parsed.embeds);
  res.json({ rows, count });
}));

/* ------------------------------------------------------------------ */
/* write                                                               */
/* ------------------------------------------------------------------ */

function assertWritable(table: string) {
  if (READ_ONLY.has(table)) throw new HttpError(403, `read_only_table:${table}`);
}

/* Financial tables must go through the domain services (waterfall allocation,
   double-entry GL postings, four-eyes, audit trail). The generic /data shim is
   read-only for them, with one exception: inserting draft/pending loan
   applications (used by the CSV bulk import). */
const DOMAIN_ONLY_HINT: Record<string, string> = {
  loans: "use_domain_endpoint:/loans/:id/decision_or_disburse",
  loan_repayments: "use_domain_endpoint:/repayments",
};

function assertDomainInsertAllowed(table: string, payload: Record<string, unknown>[]) {
  if (table === "loan_repayments") throw new HttpError(403, DOMAIN_ONLY_HINT.loan_repayments);
  if (table !== "loans") return;
  const allowed = new Set([undefined, null, "draft", "pending"]);
  for (const row of payload) {
    if (!allowed.has(row.status as never)) throw new HttpError(403, DOMAIN_ONLY_HINT.loans);
  }
}

function assertDomainMutationAllowed(table: string) {
  if (DOMAIN_ONLY_HINT[table]) throw new HttpError(403, DOMAIN_ONLY_HINT[table]);
}


// MySQL DATETIME columns reject ISO-8601 strings ("2026-08-04T12:36:30.698Z").
// The frontend sends `new Date().toISOString()`, so normalise any such value to
// the MySQL literal form in UTC before it reaches the driver.
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
function coerceValue(v: unknown): unknown {
  if (typeof v === "string" && ISO_DT.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 23).replace("T", " ");
  }
  return v;
}

// Loans may not move past application state unless the client's KYC is verified.
const LOAN_GATED_STATUSES = new Set(["approved", "disbursed", "active"]);
async function assertCustomerVerified(loanIds: string[], status: unknown) {
  if (!loanIds.length || typeof status !== "string" || !LOAN_GATED_STATUSES.has(status)) return;
  const rows = await query<RowDataPacket & { kyc_status: string; full_name: string }>(
    `SELECT c.kyc_status, c.full_name FROM loans l JOIN customers c ON c.id = l.customer_id
      WHERE l.id IN (${loanIds.map(() => "?").join(",")})`,
    loanIds
  );
  const bad = rows.find((x) => x.kyc_status !== "verified");
  if (bad) throw new HttpError(409, `client_not_verified:${bad.full_name}`);
}


async function reselect(table: string, ids: string[], select: string) {
  if (!ids.length) return [];
  const m = await meta();
  const parsed = parseSelect(select);
  const proj = projection(m, table, parsed);
  const rows = (await query<RowDataPacket>(
    `SELECT ${proj} FROM ${q(table)} WHERE ${q(table)}.${q("id")} IN (${ids.map(() => "?").join(",")})`, ids
  )).map((x) => ({ ...x })) as Record<string, unknown>[];
  await hydrateEmbeds(table, rows, parsed.embeds);
  return rows;
}

r.post("/:table", ah(async (req, res) => {
  const table = req.params.table;
  const m = await assertTable(table);
  assertWritable(table);
  const payload = (Array.isArray(req.body) ? req.body : [req.body]) as Record<string, unknown>[];
  if (!payload.length) return res.json({ rows: [], count: 0 });
  assertDomainInsertAllowed(table, payload);

  const hasId = m.cols.get(table)!.has("id");
  const ids: string[] = [];
  const cx = await pool().getConnection();
  try {
    await cx.beginTransaction();
    for (const raw of payload) {
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!m.cols.get(table)!.has(k)) continue;
        row[k] = v === undefined ? null : coerceValue(v);
      }
      if (hasId && !row.id) row.id = newId();
      const cols = Object.keys(row);
      if (!cols.length) throw new HttpError(400, "no_valid_columns");
      const upsert = String(req.query.upsert ?? "") === "true";
      const sqlText =
        `INSERT INTO ${q(table)} (${cols.map(q).join(",")}) VALUES (${cols.map(() => "?").join(",")})` +
        (upsert ? ` ON DUPLICATE KEY UPDATE ${cols.filter((c) => c !== "id").map((c) => `${q(c)} = VALUES(${q(c)})`).join(", ")}` : "");
      await cx.query(sqlText, cols.map((c) => row[c]));
      if (hasId) ids.push(String(row.id));
    }
    await cx.commit();
  } catch (e) {
    await cx.rollback();
    throw e;
  } finally {
    cx.release();
  }
  const rows = req.query.select ? await reselect(table, ids, String(req.query.select)) : [];
  res.status(201).json({ rows, count: ids.length });
}));

r.patch("/:table", ah(async (req, res) => {
  const table = req.params.table;
  const m = await assertTable(table);
  assertWritable(table);
  assertDomainMutationAllowed(table);
  const params: unknown[] = [];
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (m.cols.get(table)!.has(k) && k !== "id") patch[k] = v === undefined ? null : coerceValue(v);
  }
  const cols = Object.keys(patch);
  if (!cols.length) throw new HttpError(400, "no_valid_columns");
  cols.forEach((c) => params.push(patch[c]));

  const whereParams: unknown[] = [];
  const where = buildWhere(m, table, req.query as Record<string, unknown>, whereParams);
  if (!where) throw new HttpError(400, "update_requires_filter");

  let ids: string[] = [];
  if (m.cols.get(table)!.has("id")) {
    ids = (await query<RowDataPacket & { id: string }>(
      `SELECT ${q("id")} FROM ${q(table)} ${where}`, whereParams
    )).map((x) => x.id);
  }
  if (table === "loans") await assertCustomerVerified(ids, patch.status);
  await exec(`UPDATE ${q(table)} SET ${cols.map((c) => `${q(c)} = ?`).join(", ")} ${where}`,
    [...params, ...whereParams]);

  const rows = req.query.select ? await reselect(table, ids, String(req.query.select)) : [];
  res.json({ rows, count: ids.length });
}));

r.delete("/:table", ah(async (req, res) => {
  const table = req.params.table;
  const m = await assertTable(table);
  assertWritable(table);
  assertDomainMutationAllowed(table);
  const params: unknown[] = [];
  const where = buildWhere(m, table, req.query as Record<string, unknown>, params);
  if (!where) throw new HttpError(400, "delete_requires_filter");
  const result = await exec(`DELETE FROM ${q(table)} ${where}`, params);
  res.json({ rows: [], count: (result as { affectedRows?: number }).affectedRows ?? 0 });
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
r.use((err: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  next(err);
});

export default r;
