// PostgREST-shaped client for the Express/MySQL backend.
//
//   import { sql } from "@/lib/sql-client";
//   const { data, error } = await sql.from("loans").select("*").eq("status", "active");
//
// It mirrors the subset of the Supabase JS query builder the app used, so the
// UI code reads the same while all traffic now goes to /data, /rpc and /files
// on the Node API.

import { API_BASE, apiFetch, getAccessToken, getStoredUser, ApiError } from "@/lib/api";

export type SqlError = { message: string; code?: string } | null;
export type SqlResult<T> = { data: T; error: SqlError; count: number | null; status: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toError(e: unknown): SqlError {
  if (e instanceof ApiError) return { message: e.message, code: e.code };
  return { message: e instanceof Error ? e.message : "request_failed" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class QueryBuilder<T = any[]> implements PromiseLike<SqlResult<T>> {
  private filters: string[][] = [];
  private orders: string[] = [];
  private selectStr = "*";
  private _limit?: number;
  private _offset?: number;
  private _count?: "exact";
  private _head = false;
  private _single: "one" | "maybe" | null = null;
  private method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  private body: unknown;
  private upsert = false;
  private returning = false;

  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    this.selectStr = cols;
    if (opts?.count) this._count = opts.count;
    if (opts?.head) this._head = true;
    if (this.method !== "GET") this.returning = true;
    return this;
  }

  insert(values: Row | Row[]) { this.method = "POST"; this.body = values; return this; }
  upsertRows(values: Row | Row[]) { this.method = "POST"; this.body = values; this.upsert = true; return this; }
  update(values: Row) { this.method = "PATCH"; this.body = values; return this; }
  delete() { this.method = "DELETE"; return this; }

  eq(col: string, v: unknown) { return this.filter(col, `eq.${v}`); }
  neq(col: string, v: unknown) { return this.filter(col, `neq.${v}`); }
  gt(col: string, v: unknown) { return this.filter(col, `gt.${v}`); }
  gte(col: string, v: unknown) { return this.filter(col, `gte.${v}`); }
  lt(col: string, v: unknown) { return this.filter(col, `lt.${v}`); }
  lte(col: string, v: unknown) { return this.filter(col, `lte.${v}`); }
  like(col: string, v: string) { return this.filter(col, `like.${v}`); }
  ilike(col: string, v: string) { return this.filter(col, `ilike.${v}`); }
  is(col: string, v: null | boolean) { return this.filter(col, `is.${v}`); }
  in(col: string, vals: readonly unknown[]) { return this.filter(col, `in.(${vals.join(",")})`); }
  not(col: string, op: string, v: unknown) { return this.filter(col, `not.${op}.${v}`); }
  or(expr: string) { this.filters.push(["or", `(${expr})`]); return this; }
  filter(col: string, expr: string) { this.filters.push([col, expr]); return this; }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? "desc" : "asc";
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? ".nullsfirst" : ".nullslast";
    this.orders.push(`${col}.${dir}${nulls}`);
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  range(from: number, to: number) { this._offset = from; this._limit = to - from + 1; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  single() { this._single = "one"; return this as unknown as QueryBuilder<any>; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maybeSingle() { this._single = "maybe"; return this as unknown as QueryBuilder<any>; }

  private path() {
    const p = new URLSearchParams();
    if (this.method === "GET" || this.returning) p.set("select", this.selectStr);
    for (const [k, v] of this.filters) p.append(k, v);
    for (const o of this.orders) p.append("order", o);
    if (this._limit !== undefined) p.set("limit", String(this._limit));
    if (this._offset !== undefined) p.set("offset", String(this._offset));
    if (this._count) p.set("count", this._count);
    if (this._head) p.set("head", "true");
    if (this.upsert) p.set("upsert", "true");
    const qs = p.toString();
    return `/data/${this.table}${qs ? `?${qs}` : ""}`;
  }

  async run(): Promise<SqlResult<T>> {
    try {
      const res = await apiFetch<{ rows: Row[]; count: number | null }>(this.path(), {
        method: this.method,
        body: this.body,
      });
      let data: unknown = res.rows ?? [];
      if (this._single === "one") {
        const rows = res.rows ?? [];
        if (rows.length !== 1) {
          return { data: null as T, error: { message: "no_rows_returned", code: "PGRST116" }, count: res.count ?? null, status: 406 };
        }
        data = rows[0];
      } else if (this._single === "maybe") {
        data = (res.rows ?? [])[0] ?? null;
      }
      return { data: data as T, error: null, count: res.count ?? null, status: 200 };
    } catch (e) {
      return {
        data: (this._single ? null : []) as T,
        error: toError(e),
        count: null,
        status: e instanceof ApiError ? e.status : 500,
      };
    }
  }

  then<R1 = SqlResult<T>, R2 = never>(
    onfulfilled?: ((value: SqlResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/* ---------------- storage ---------------- */

function bucket(name: string) {
  return {
    async upload(path: string, file: File | Blob) {
      const fd = new FormData();
      fd.append("path", path);
      fd.append("file", file);
      try {
        const out = await apiFetch<{ path: string }>(`/files/${name}`, { method: "POST", body: fd, formData: true });
        return { data: out, error: null as SqlError };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
    async createSignedUrl(path: string, expiresIn = 600) {
      try {
        const out = await apiFetch<{ signedUrl: string }>(
          `/files/${name}/signed?path=${encodeURIComponent(path)}&expiresIn=${expiresIn}`
        );
        return { data: out, error: null as SqlError };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
    async remove(paths: string[]) {
      try {
        await apiFetch(`/files/${name}?path=${encodeURIComponent(paths.join(","))}`, { method: "DELETE" });
        return { data: { paths }, error: null as SqlError };
      } catch (e) {
        return { data: null, error: toError(e) };
      }
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: `${API_BASE}/files/${name}/object?path=${encodeURIComponent(path)}` } };
    },
  };
}

/* ---------------- public surface ---------------- */

export const sql = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => new QueryBuilder<any[]>(table),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rpc<T = any>(name: string, args?: Row): Promise<{ data: T | null; error: SqlError }> {
    try {
      const out = await apiFetch<{ data: T }>(`/rpc/${name}`, { method: "POST", body: args ?? {} });
      return { data: out.data ?? null, error: null };
    } catch (e) {
      return { data: null, error: toError(e) };
    }
  },

  storage: { from: bucket },

  auth: {
    async getUser() {
      const u = getStoredUser();
      return { data: { user: u ? { id: u.id, email: u.email } : null }, error: null as SqlError };
    },
    async getSession() {
      const token = getAccessToken();
      const u = getStoredUser();
      return {
        data: { session: token && u ? { access_token: token, user: { id: u.id, email: u.email } } : null },
        error: null as SqlError,
      };
    },
  },
};

export default sql;
