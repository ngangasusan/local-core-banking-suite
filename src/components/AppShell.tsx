import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
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
  HandCoins,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { sql } from "@/lib/sql-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlobalSearch } from "@/components/GlobalSearch";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  requireAdmin?: boolean;
  requirePrivileged?: boolean;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/customers", label: "Clients", icon: Users },
  { to: "/loans", label: "Loans", icon: Banknote },
  { to: "/loan-products", label: "Loan Products", icon: Scale },
  { to: "/accounts", label: "Deposits", icon: Wallet },
  { to: "/transactions", label: "Loan Transactions", icon: ArrowLeftRight },
  { to: "/arrears", label: "Arrears", icon: AlertTriangle },
  { to: "/collections", label: "Collections", icon: HandCoins },
  { to: "/audit", label: "Activities", icon: ShieldCheck, requirePrivileged: true },
  { to: "/users", label: "Users", icon: UserCog, requireAdmin: true },
  { to: "/reports", label: "Reporting", icon: FileBarChart },
  { to: "/ledger", label: "Accounting", icon: BookOpen },
  { to: "/reconciliation", label: "Reconciliation", icon: Scale, requirePrivileged: true },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Administration", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roles, signOut, hasRole } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const isPrivileged = isAdmin || hasRole("auditor");

  const { data: unread = 0 } = useQuery({
    queryKey: ["unread-notif", user?.id],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await sql
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

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const initials = (user?.email ?? "?")
    .split("@")[0]
    .split(/[._-]/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="sticky top-0 z-40 shadow-sm">
      {/* Top brand bar */}
      <div className="h-14 bg-sidebar border-b border-sidebar-border flex items-center px-4 sm:px-6 gap-4">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
            <Building2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold text-sidebar-foreground tracking-tight leading-none">
              CoreBank
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">On-Prem Banking</div>
          </div>
        </Link>

        {/* Global search */}
        <div className="flex-1 flex justify-center px-2">
          <GlobalSearch />
        </div>

        {/* Company name */}
        <div className="hidden lg:flex flex-col items-end leading-tight shrink-0">
          <span className="text-xs font-semibold text-sidebar-foreground">
            CoreBank Microfinance Ltd
          </span>
          <span className="text-[10px] text-muted-foreground">HQ • Nairobi Branch</span>
        </div>

        <Link
          to="/notifications"
          className="relative h-9 w-9 rounded-md flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-sidebar-accent/60 transition-colors text-sidebar-foreground"
              aria-label="User menu"
            >
              <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center justify-center">
                {mounted ? initials || "U" : "U"}
              </div>
              <div className="hidden md:flex flex-col items-start min-w-0 max-w-[160px]">
                <span className="text-xs font-medium truncate w-full text-left">
                  {user?.email}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize truncate w-full text-left">
                  {roles.join(", ") || "no role"}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium truncate">{user?.email}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {roles.join(", ") || "no role"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="cursor-pointer">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          className="md:hidden h-9 w-9 rounded-md flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Desktop nav row */}
      <nav className="hidden md:block bg-card border-b border-border">
        <div
          ref={navScrollRef}
          onScroll={(e) => { navScrollLeft = e.currentTarget.scrollLeft; }}
          className="px-4 sm:px-6 flex items-center gap-1 overflow-x-auto no-scrollbar"
        >
          {visibleNav.map(({ to, label, icon: Icon }) => {
            const active = isActive(to);
            return (
              <Link
                key={to}
                to={to}
                className={
                  "relative flex items-center gap-1.5 px-3 h-11 text-sm whitespace-nowrap transition-colors " +
                  (active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav className="md:hidden bg-card border-b border-border max-h-[60vh] overflow-y-auto">
          <div className="p-2 grid grid-cols-1 gap-0.5">
            {visibleNav.map(({ to, label, icon: Icon }) => {
              const active = isActive(to);
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors " +
                    (active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-accent/60")
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
      </div>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
