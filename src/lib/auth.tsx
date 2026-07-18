import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  USE_NODE_API,
  fetchMe,
  getAccessToken,
  getStoredUser,
  logout as apiLogout,
  setAccessToken,
  setStoredUser,
  type ApiUser,
} from "@/lib/api";

export type AppRole = "super_admin" | "admin" | "manager" | "teller" | "loan_officer" | "finance_officer" | "auditor";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (r: AppRole) => boolean;
  /** Node-mode only: manually refresh session after login/mfa. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Shape ApiUser into a Supabase-User-lookalike so existing UI keeps compiling.
function toUser(u: ApiUser | null): User | null {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    user_metadata: { full_name: u.full_name },
    app_metadata: { roles: u.roles },
    aud: "authenticated",
    created_at: "",
  } as unknown as User;
}
function toSession(token: string | null): Session | null {
  if (!token) return null;
  return { access_token: token, token_type: "bearer" } as unknown as Session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const applyNodeUser = useCallback((u: ApiUser | null) => {
    setUser(toUser(u));
    setSession(toSession(u ? getAccessToken() : null));
    setRoles((u?.roles as AppRole[]) ?? []);
  }, []);

  const refresh = useCallback(async () => {
    if (USE_NODE_API) {
      const u = await fetchMe();
      applyNodeUser(u);
    }
  }, [applyNodeUser]);

  useEffect(() => {
    if (USE_NODE_API) {
      // hydrate from localStorage, then verify with backend
      applyNodeUser(getStoredUser());
      (async () => {
        const u = await fetchMe();
        applyNodeUser(u);
        setLoading(false);
      })();
      const onStorage = (e: StorageEvent) => {
        if (e.key === "cb.access" || e.key === "cb.user") applyNodeUser(getStoredUser());
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }

    // --- Supabase fallback path (preview) ---
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) setTimeout(() => loadRoles(s.user.id), 0);
      else setRoles([]);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) loadRoles(s.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [applyNodeUser]);

  async function loadRoles(uid: string) {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", uid);
    setRoles((data?.map((r) => r.role) as AppRole[]) ?? []);
  }

  async function signOut() {
    if (USE_NODE_API) {
      await apiLogout();
      setAccessToken(null);
      setStoredUser(null);
      applyNodeUser(null);
      return;
    }
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ user, session, roles, loading, signOut, refresh, hasRole: (r) => roles.includes(r) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
