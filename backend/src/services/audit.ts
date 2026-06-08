// Hash-chained audit log. Each row chains SHA-256(prev_hash || payload). Mirrors
// the previous Postgres audit_chain_hash trigger. Accepts an optional connection
// so callers can append within the same transaction as the business change.
import { createHash } from "node:crypto";
import { pool, type PoolConnection, type RowDataPacket } from "../db.js";
import { newId } from "../util/uuid.js";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export interface AuditOpts {
  userId: string | null | undefined;
  action: AuditAction;
  table: string;
  recordId: string | null | undefined;
  oldData?: unknown;
  newData?: unknown;
}

export async function writeAudit(opts: AuditOpts, cx?: PoolConnection): Promise<void> {
  const conn = cx ?? pool();
  const [prevRows] = await conn.query<(RowDataPacket & { entry_hash: Buffer | null })[]>(
    "SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1"
  );
  const prevHash = prevRows[0]?.entry_hash ?? null;
  const id = newId();
  const createdAt = new Date().toISOString();
  const payload =
    (prevHash ? prevHash.toString("hex") : "") +
    id + (opts.userId ?? "") + opts.action + opts.table +
    (opts.recordId ?? "") +
    (opts.oldData ? JSON.stringify(opts.oldData) : "") +
    (opts.newData ? JSON.stringify(opts.newData) : "") +
    createdAt;
  const entryHash = createHash("sha256").update(payload).digest();
  await conn.query(
    `INSERT INTO audit_log
       (id, user_id, action, table_name, record_id, old_data, new_data, prev_hash, entry_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, opts.userId ?? null, opts.action, opts.table, opts.recordId ?? null,
      opts.oldData ? JSON.stringify(opts.oldData) : null,
      opts.newData ? JSON.stringify(opts.newData) : null,
      prevHash, entryHash, createdAt.replace("T", " ").replace("Z", ""),
    ]
  );
}

/** Walks the chain and reports the first broken row (if any) and total count. */
export async function verifyAuditChain(): Promise<{ broken_seq: number | null; total: number }> {
  const [rows] = await pool().query<(RowDataPacket & {
    seq: number; id: string; user_id: string | null; action: string; table_name: string;
    record_id: string | null; old_data: unknown; new_data: unknown;
    prev_hash: Buffer | null; entry_hash: Buffer | null; created_at: Date;
  })[]>(
    "SELECT seq, id, user_id, action, table_name, record_id, old_data, new_data, prev_hash, entry_hash, created_at FROM audit_log ORDER BY seq ASC"
  );
  let prev: Buffer | null = null;
  let broken: number | null = null;
  for (const r of rows) {
    const createdAt = new Date(r.created_at).toISOString();
    const payload =
      (prev ? prev.toString("hex") : "") +
      r.id + (r.user_id ?? "") + r.action + r.table_name +
      (r.record_id ?? "") +
      (r.old_data ? JSON.stringify(r.old_data) : "") +
      (r.new_data ? JSON.stringify(r.new_data) : "") +
      createdAt;
    const expected = createHash("sha256").update(payload).digest();
    if (broken === null && (!r.entry_hash || !expected.equals(r.entry_hash))) broken = r.seq;
    prev = r.entry_hash;
  }
  return { broken_seq: broken, total: rows.length };
}
