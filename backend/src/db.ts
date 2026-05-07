import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import { env } from "./env.js";

let _pool: Pool | undefined;

export function pool(): Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      uri: env.MYSQL_URL,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
      waitForConnections: true,
      multipleStatements: false,
      decimalNumbers: false, // keep DECIMAL as strings to avoid precision loss
      dateStrings: false,
      timezone: "Z",
      namedPlaceholders: false,
    });
  }
  return _pool;
}

export async function query<T extends RowDataPacket = RowDataPacket>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [rows] = await pool().query<T[]>(sql, params);
  return rows;
}

export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool().query<ResultSetHeader>(sql, params);
  return res;
}

export async function tx<T>(fn: (cx: PoolConnection) => Promise<T>): Promise<T> {
  const cx = await pool().getConnection();
  try {
    await cx.beginTransaction();
    const out = await fn(cx);
    await cx.commit();
    return out;
  } catch (e) {
    try { await cx.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    cx.release();
  }
}

export type { RowDataPacket, ResultSetHeader, PoolConnection };
