// Typed fetch client for the Express/MySQL backend (PR 6 cutover).
// Base URL comes from VITE_API_URL. When unset the app falls back to Supabase
// so the Lovable preview keeps working; set VITE_API_URL in your .env to flip
// the frontend onto the Node backend.

const CONFIGURED_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const API_BASE = CONFIGURED_BASE ?? "http://localhost:8080";
export const USE_NODE_API = true;

/**
 * True when the API base resolves to the page's own origin (e.g. Vite dev server
 * also running on :8080). Every request would then hit the frontend and return 404.
 */
export function apiBaseCollidesWithApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(API_BASE).origin === window.location.origin;
  } catch {
    return false;
  }
}


const ACCESS_KEY = "cb.access";
const USER_KEY = "cb.user";

export type ApiUser = {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
  mfa_enrolled?: boolean;
  mfa?: boolean;
};

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}
export function setAccessToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(ACCESS_KEY, t);
  else window.localStorage.removeItem(ACCESS_KEY);
}
export function getStoredUser(): ApiUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ApiUser; } catch { return null; }
}
export function setStoredUser(u: ApiUser | null) {
  if (typeof window === "undefined") return;
  if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
  else window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;
  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type Opts = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Set false to skip the automatic refresh-on-401 retry (used by /auth/refresh). */
  autoRefresh?: boolean;
  /** Send as FormData (for uploads). If true, `body` must be a FormData. */
  formData?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!USE_NODE_API) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string; user: ApiUser };
      setAccessToken(data.access_token);
      setStoredUser(data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function buildUrl(path: string, query?: Opts["query"]) {
  const base = API_BASE || "";
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  if (!USE_NODE_API) throw new ApiError(0, "Node API not configured (VITE_API_URL missing)");
  const doOnce = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (opts.body !== undefined && opts.body !== null) {
      if (opts.formData) {
        body = opts.body as FormData;
      } else {
        headers["Content-Type"] ??= "application/json";
        body = JSON.stringify(opts.body);
      }
    }
    return fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: opts.signal,
    });
  };

  let res = await doOnce();
  if (res.status === 401 && opts.autoRefresh !== false) {
    const ok = await refreshOnce();
    if (ok) res = await doOnce();
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const code = (data && typeof data === "object" && "error" in data) ? String((data as { error: unknown }).error) : undefined;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, code, data);
  }
  return data as T;
}

export const api = {
  get:   <T = unknown>(p: string, o?: Omit<Opts, "method" | "body">) => apiFetch<T>(p, { ...o, method: "GET" }),
  post:  <T = unknown>(p: string, body?: unknown, o?: Omit<Opts, "method" | "body">) => apiFetch<T>(p, { ...o, method: "POST", body }),
  patch: <T = unknown>(p: string, body?: unknown, o?: Omit<Opts, "method" | "body">) => apiFetch<T>(p, { ...o, method: "PATCH", body }),
  put:   <T = unknown>(p: string, body?: unknown, o?: Omit<Opts, "method" | "body">) => apiFetch<T>(p, { ...o, method: "PUT", body }),
  del:   <T = unknown>(p: string, o?: Omit<Opts, "method" | "body">) => apiFetch<T>(p, { ...o, method: "DELETE" }),
  upload:<T = unknown>(p: string, fd: FormData) => apiFetch<T>(p, { method: "POST", body: fd, formData: true }),
};

// ---- Auth surface used by src/lib/auth.tsx and src/routes/auth.tsx ----

export type LoginResult =
  | { kind: "ok"; access_token: string; user: ApiUser }
  | { kind: "mfa"; pre_auth_token: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await apiFetch<{ access_token?: string; user?: ApiUser; mfa_required?: boolean; pre_auth_token?: string }>(
    "/auth/login",
    { method: "POST", body: { email, password }, autoRefresh: false }
  );
  if (data.mfa_required && data.pre_auth_token) return { kind: "mfa", pre_auth_token: data.pre_auth_token };
  if (!data.access_token || !data.user) throw new ApiError(500, "invalid_login_response");
  setAccessToken(data.access_token);
  setStoredUser(data.user);
  return { kind: "ok", access_token: data.access_token, user: data.user };
}

export async function verifyMfa(code: string, preAuthToken: string): Promise<ApiUser> {
  const data = await apiFetch<{ access_token: string; user: ApiUser }>(
    "/auth/mfa/verify",
    { method: "POST", body: { code }, headers: { Authorization: `Bearer ${preAuthToken}` }, autoRefresh: false }
  );
  setAccessToken(data.access_token);
  setStoredUser(data.user);
  return data.user;
}

export async function bootstrap(email: string, password: string, full_name: string): Promise<{ id: string }> {
  return apiFetch("/auth/bootstrap", { method: "POST", body: { email, password, full_name }, autoRefresh: false });
}

export async function fetchMe(): Promise<ApiUser | null> {
  try {
    const u = await apiFetch<ApiUser>("/auth/me");
    setStoredUser(u);
    return u;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      // try refresh once
      const ok = await refreshOnce();
      if (ok) {
        try { return await apiFetch<ApiUser>("/auth/me"); } catch { /* fall through */ }
      }
    }
    return null;
  }
}

export async function logout(): Promise<void> {
  try { await apiFetch("/auth/logout", { method: "POST", autoRefresh: false }); } catch { /* ignore */ }
  setAccessToken(null);
  setStoredUser(null);
}
