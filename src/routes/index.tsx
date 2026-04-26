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
            <h3 className="font-semibold mb-1">Portfolio at a glance</h3>
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
