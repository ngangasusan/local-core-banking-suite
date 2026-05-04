import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Wallet,
  Banknote,
  ArrowLeftRight,
  BookOpen,
  FileBarChart,
  Settings,
  LogOut,
  Building2,
  Bell,
  ShieldCheck,
  UserCog,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  requireAdmin?: boolean;
  requirePrivileged?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/loans", label: "Loans", icon: Banknote },
  { to: "/arrears", label: "Arrears & PAR", icon: AlertTriangle },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/ledger", label: "General Ledger", icon: BookOpen },
  { to: "/reconciliation", label: "Reconciliation", icon: Scale, requirePrivileged: true },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/users", label: "User Management", icon: UserCog, requireAdmin: true },
  { to: "/audit", label: "Audit Log", icon: ShieldCheck, requirePrivileged: true },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roles, signOut, hasRole } = useAuth();

  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const isPrivileged = isAdmin || hasRole("auditor");

  const { data: unread = 0 } = useQuery({
    queryKey: ["unread-notif", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("is_read", false);
      return count ?? 0;
    },
  });

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  const visibleNav = NAV.filter((n) => {
    if (n.requireAdmin && !isAdmin) return false;
    if (n.requirePrivileged && !isPrivileged) return false;
    return true;
  });

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="p-6 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sidebar-foreground tracking-tight">CoreBank</div>
            <div className="text-xs text-muted-foreground">On-Prem Banking</div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon }) => {
            const active =
              to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
            const showBadge = to === "/notifications" && unread > 0;
            return (
              <Link
                key={to}
                to={to}
                className={
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors " +
                  (active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60")
                }
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{label}</span>
                {showBadge && (
                  <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="text-sm font-medium text-sidebar-foreground truncate">
            {user?.email}
          </div>
          <div className="text-xs text-muted-foreground capitalize mb-3">
            {roles.join(", ") || "no role"}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-3.5 w-3.5 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <Building2 className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">CoreBank</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </main>
    </div>
  );
}
