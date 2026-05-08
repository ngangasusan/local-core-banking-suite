// Lightweight audit writer used by CRUD routes in PR 2.
// PR 3 will replace this with the full hash-chained version inside transactions.
import { createHash } from "node:crypto";
import { exec, query, type RowDataPacket } from "../db.js";
import { newId } from "../util/uuid.js";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

export async function writeAudit(opts: {
  userId: string | null | undefined;
  action: AuditAction;
  table: string;
  recordId: string | null | undefined;
  oldData?: unknown;
  newData?: unknown;
}): Promise<void> {
  const [prev] = await query<RowDataPacket & { entry_hash: Buffer | null }>(
    "SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1"
  );
  const prevHash = prev?.entry_hash ?? null;
  const id = newId();
  const payload = JSON.stringify({
    id, userId: opts.userId, action: opts.action,
    table: opts.table, recordId: opts.recordId,
    old: opts.oldData ?? null, new: opts.newData ?? null,
    prev: prevHash ? prevHash.toString("hex") : null,
  });
  const entryHash = createHash("sha256").update(payload).digest();
  await exec(
    `INSERT INTO audit_log (id, user_id, action, table_name, record_id, old_data, new_data, prev_hash, entry_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, opts.userId, opts.action, opts.table, opts.recordId,
      opts.oldData ? JSON.stringify(opts.oldData) : null,
      opts.newData ? JSON.stringify(opts.newData) : null,
      prevHash, entryHash,
    ]
  );
}
