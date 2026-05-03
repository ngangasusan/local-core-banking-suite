import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Wallet, Banknote, ArrowLeftRight, TrendingUp, AlertTriangle, CalendarClock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    enabled: !!user,
    queryFn: async () => {
      const [c, a, l, t] = await Promise.all([
        supabase.from("customers").select("*", { count: "exact", head: true }),
        supabase.from("accounts").select("balance"),
        supabase.from("loan_portfolio").select("outstanding_balance,status"),
        supabase.from("transactions").select("amount,created_at").gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      ]);
      const totalDeposits = (a.data ?? []).reduce((s, r) => s + Number(r.balance || 0), 0);
      const portfolio = (l.data ?? []).reduce((s, r) => s + Number(r.outstanding_balance || 0), 0);
      const inArrears = (l.data ?? []).filter((r) => r.status === "in_arrears").length;
      const txnVol = (t.data ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
      return {
        customers: c.count ?? 0,
        deposits: totalDeposits,
        portfolio,
        inArrears,
        txnVol,
        txnCount: t.data?.length ?? 0,
      };
    },
  });

  const { data: dueSoon = [] } = useQuery({
    queryKey: ["loans-due-soon"],
    enabled: !!user,
    queryFn: async () => {
      const today = new Date();
      const inWeek = new Date(Date.now() + 7 * 86400000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, due_date, outstanding_balance, status, customer:customers(full_name)")
        .in("status", ["active", "in_arrears"])
        .gt("outstanding_balance", 0)
        .lte("due_date", fmt(inWeek))
        .order("due_date", { ascending: true })
        .limit(20);
      return (data ?? []).filter((l) => l.due_date).map((l) => {
        const d = new Date(l.due_date as string);
        const days = Math.floor((d.getTime() - today.getTime()) / 86400000);
        return { ...l, daysToDue: days };
      });
    },
  });

  const { data: disbursements } = useQuery({
    queryKey: ["disbursements-by-year-month"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("principal, disbursement_date, disbursed_at")
        .not("disbursement_date", "is", null);
      const byYear: Record<string, number> = {};
      const byMonthCurrent: Record<number, number> = {};
      const currentYear = new Date().getFullYear();
      for (const l of data ?? []) {
        const ds = (l.disbursement_date as string) ?? (l.disbursed_at as string)?.slice(0, 10);
        if (!ds) continue;
        const d = new Date(ds);
        const y = d.getFullYear();
        const amt = Number(l.principal || 0);
        byYear[y] = (byYear[y] ?? 0) + amt;
        if (y === currentYear) {
          const m = d.getMonth();
          byMonthCurrent[m] = (byMonthCurrent[m] ?? 0) + amt;
        }
      }
      const years = Object.keys(byYear).map(Number).sort((a, b) => a - b)
        .map((y) => ({ year: y, amount: byYear[y] }));
      const months = Array.from({ length: 12 }, (_, i) => ({
        month: new Date(currentYear, i, 1).toLocaleString("en", { month: "short" }),
        amount: byMonthCurrent[i] ?? 0,
      }));
      return { years, months, currentYear };
    },
  });

  if (loading || !user) return null;

  const cards = [
    { label: "Customers", value: stats?.customers ?? 0, icon: Users, link: "/customers" },
    { label: "Total Deposits", value: fmtKES(stats?.deposits ?? 0), icon: Wallet, link: "/accounts" },
    { label: "Loan Portfolio", value: fmtKES(stats?.portfolio ?? 0), icon: Banknote, link: "/loans" },
    { label: "24h Txn Volume", value: fmtKES(stats?.txnVol ?? 0), icon: ArrowLeftRight, link: "/transactions" },
  ];

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Operations Dashboard"
          description="Snapshot of your institution's performance and pipeline."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {cards.map(({ label, value, icon: Icon, link }) => (
            <Link
              key={label}
              to={link}
              className="bg-card border border-border rounded-xl p-5 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
                <div className="h-8 w-8 rounded-md bg-primary-soft flex items-center justify-center text-primary">
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="text-2xl font-semibold tracking-tight">{value}</div>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold">Portfolio at a glance</h3>
              <Link to="/arrears" className="text-xs text-primary hover:underline">PAR breakdown →</Link>
            </div>
            <p className="text-sm text-muted-foreground mb-6">Quick metrics on your active book.</p>
            <div className="grid grid-cols-2 gap-6">
              <Metric icon={TrendingUp} label="Transactions today" value={String(stats?.txnCount ?? 0)} tone="success" />
              <Metric icon={AlertTriangle} label="Loans in arrears" value={String(stats?.inArrears ?? 0)} tone="warning" />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-semibold mb-1">Quick actions</h3>
            <p className="text-sm text-muted-foreground mb-4">Common operator tasks.</p>
            <div className="space-y-2">
              <Link to="/customers" className="block px-3 py-2 rounded-md text-sm hover:bg-accent">
                + New customer
              </Link>
              <Link to="/accounts" className="block px-3 py-2 rounded-md text-sm hover:bg-accent">
                + Open account
              </Link>
              <Link to="/loans" className="block px-3 py-2 rounded-md text-sm hover:bg-accent">
                + Originate loan
              </Link>
              <Link to="/transactions" className="block px-3 py-2 rounded-md text-sm hover:bg-accent">
                + Post transaction
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" />Loans due in the next 7 days</h3>
              <p className="text-sm text-muted-foreground">Customers to follow up with this week. Includes loans already overdue.</p>
            </div>
            <Link to="/loans" className="text-sm text-primary hover:underline">View all loans →</Link>
          </div>
          {dueSoon.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No loans due within 7 days. ✅</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left py-2 pr-4 font-medium">Loan #</th>
                    <th className="text-left py-2 pr-4 font-medium">Customer</th>
                    <th className="text-left py-2 pr-4 font-medium">Due date</th>
                    <th className="text-left py-2 pr-4 font-medium">When</th>
                    <th className="text-right py-2 font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {dueSoon.map((l) => {
                    const overdue = l.daysToDue < 0;
                    const today = l.daysToDue === 0;
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-2 pr-4 font-mono text-xs">{l.loan_number}</td>
                        <td className="py-2 pr-4">{l.customer?.full_name ?? "—"}</td>
                        <td className="py-2 pr-4 text-xs">{l.due_date}</td>
                        <td className="py-2 pr-4">
                          <span className={"text-xs px-2 py-0.5 rounded font-medium " + (overdue ? "bg-destructive/15 text-destructive" : today ? "bg-warning/15 text-warning-foreground" : "bg-primary-soft text-primary")}>
                            {overdue ? `${Math.abs(l.daysToDue)}d overdue` : today ? "due today" : `in ${l.daysToDue}d`}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">{fmtKES(Number(l.outstanding_balance))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  tone: "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "bg-success/10 text-success" : "bg-warning/15 text-warning-foreground";
  return (
    <div className="flex items-start gap-3">
      <div className={"h-9 w-9 rounded-md flex items-center justify-center " + toneClass}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </div>
  );
}

function fmtKES(n: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);
}
