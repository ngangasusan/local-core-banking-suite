import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fetchMe,
  getAccessToken,
  getStoredUser,
  logout as apiLogout,
  setAccessToken,
  setStoredUser,
  type ApiUser,
} from "@/lib/api";

export type AppRole = "super_admin" | "admin" | "manager" | "teller" | "loan_officer" | "finance_officer" | "auditor";

export type AuthUser = { id: string; email: string; user_metadata: { full_name: string } };
export type AuthSession = { access_token: string; token_type: "bearer" };

interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (r: AppRole) => boolean;
  /** Refresh the session after login / MFA verification. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toUser(u: ApiUser | null): AuthUser | null {
  if (!u) return null;
  return { id: u.id, email: u.email, user_metadata: { full_name: u.full_name } };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((u: ApiUser | null) => {
    setUser(toUser(u));
    const token = u ? getAccessToken() : null;
    setSession(token ? { access_token: token, token_type: "bearer" } : null);
    setRoles((u?.roles as AppRole[]) ?? []);
  }, []);

  const refresh = useCallback(async () => {
    const u = await fetchMe();
    apply(u);
  }, [apply]);

  useEffect(() => {
    apply(getStoredUser());
    (async () => {
      const u = await fetchMe();
      apply(u);
      setLoading(false);
    })();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cb.access" || e.key === "cb.user") apply(getStoredUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [apply]);

  async function signOut() {
    await apiLogout();
    setAccessToken(null);
    setStoredUser(null);
    apply(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, signOut, refresh, hasRole: (r) => roles.includes(r) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
