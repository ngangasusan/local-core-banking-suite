import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Banknote, AlertTriangle, Clock, Wallet, FileBarChart, HandCoins, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtKES } from "@/lib/format";

export function DashboardSidebar() {
  const { data: tasks } = useQuery({
    queryKey: ["dashboard-tasks"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("loans")
        .select("id, due_date, status, outstanding_balance")
        .in("status", ["active", "in_arrears"])
        .gt("outstanding_balance", 0)
        .lte("due_date", in7);
      let overdue = 0, dueToday = 0, upcoming = 0;
      for (const l of data ?? []) {
        if (!l.due_date) continue;
        if (l.due_date < todayStr) overdue++;
        else if (l.due_date === todayStr) dueToday++;
        else upcoming++;
      }
      return { overdue, dueToday, upcoming };
    },
  });

  const { data: indicators } = useQuery({
    queryKey: ["dashboard-indicators"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [clients, allLoans, active, pending] = await Promise.all([
        supabase.from("customers").select("*", { count: "exact", head: true }),
        supabase.from("loans").select("status, outstanding_balance, principal, due_date"),
        supabase.from("customers").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("loans").select("*", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const loans = allLoans.data ?? [];
      const gross = loans.reduce((s, r) => s + Number(r.outstanding_balance || 0), 0);
      const pendingDisbursal = loans.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.principal || 0), 0);
      const dpd = (l: { due_date: string | null; status: string | null; outstanding_balance: number | string }) =>
        l.due_date && (l.status === "active" || l.status === "in_arrears") && Number(l.outstanding_balance) > 0
          ? Math.floor((Date.parse(today) - Date.parse(l.due_date)) / 86400000)
          : 0;
      const par7 = loans.filter((l) => dpd(l) > 7).length;
      const par30 = loans.filter((l) => dpd(l) > 30).length;
      const par90 = loans.filter((l) => dpd(l) > 90).length;
      const arrears = loans.filter((l) => l.status === "in_arrears").length;
      return {
        clients: clients.count ?? 0,
        gross,
        active: active.count ?? 0,
        pending: pending.count ?? 0,
        par30, par7, par90,
        awaiting: pending.count ?? 0,
        arrears,
        pendingDisbursal,
      };
    },
  });

  return (
    <div className="space-y-4">
      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold tracking-tight mb-4">YOUR TASKS</h3>
        <div className="grid grid-cols-3 gap-2">
          <TaskTile label="OVERDUE" value={tasks?.overdue ?? 0} to="/arrears" tone="destructive" icon={AlertTriangle} />
          <TaskTile label="DUE TODAY" value={tasks?.dueToday ?? 0} to="/loans" tone="warning" icon={Clock} />
          <TaskTile label="UPCOMING" value={tasks?.upcoming ?? 0} to="/loans" tone="primary" icon={Clock} />
        </div>
        {(tasks?.overdue ?? 0) + (tasks?.dueToday ?? 0) + (tasks?.upcoming ?? 0) === 0 && (
          <div className="text-sm text-muted-foreground text-center mt-6">You don't have any tasks due at the moment</div>
        )}
        <div className="flex justify-end gap-3 mt-4 text-xs">
          <Link to="/collections" className="text-primary hover:underline">+ New Task</Link>
          <Link to="/loans" className="text-primary hover:underline">All Tasks</Link>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold tracking-tight mb-4">YOUR FAVOURITE VIEWS</h3>
        <div className="grid grid-cols-1 gap-1.5">
          <FavLink to="/customers" icon={Users} label="All clients" />
          <FavLink to="/loans" icon={Banknote} label="Loans portfolio" />
          <FavLink to="/collections" icon={HandCoins} label="Collections worklist" />
          <FavLink to="/reports" icon={FileBarChart} label="Reports" />
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold tracking-tight mb-4">INDICATORS</h3>
        <div className="grid grid-cols-2 gap-2">
          <Indicator label="Number Of Clients" value={String(indicators?.clients ?? 0)} to="/customers" />
          <Indicator label="Gross Loan Portfolio" value={fmtKES(indicators?.gross ?? 0)} to="/loans" />
          <Indicator label="Active Clients" value={String(indicators?.active ?? 0)} to="/customers" />
          <Indicator label="Loans Pending Disbursal" value={String(indicators?.pending ?? 0)} to="/loans" />
          <Indicator label="PAR > 30 Days" value={String(indicators?.par30 ?? 0)} to="/arrears" />
          <Indicator label="Loans Awaiting Approval" value={String(indicators?.awaiting ?? 0)} to="/loans" />
          <Indicator label="Portfolio Pending Disbursal" value={fmtKES(indicators?.pendingDisbursal ?? 0)} to="/loans" />
          <Indicator label="Loans In Arrears" value={String(indicators?.arrears ?? 0)} to="/arrears" />
          <Indicator label="PAR > 7 Days" value={String(indicators?.par7 ?? 0)} to="/arrears" />
          <Indicator label="PAR > 90 Days" value={String(indicators?.par90 ?? 0)} to="/arrears" />
        </div>
      </section>
    </div>
  );
}

function TaskTile({
  label,
  value,
  to,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  to: string;
  tone: "destructive" | "warning" | "primary";
  icon: typeof Clock;
}) {
  const cls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
      ? "text-warning-foreground"
      : "text-primary";
  return (
    <Link to={to} className="rounded-lg border border-border p-3 hover:bg-accent transition-colors text-center">
      <Icon className={"h-3.5 w-3.5 mx-auto mb-1 " + cls} />
      <div className={"text-2xl font-semibold " + (value === 0 ? "text-muted-foreground" : cls)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">{label}</div>
    </Link>
  );
}

function FavLink({ to, icon: Icon, label }: { to: string; icon: typeof Users; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-primary hover:bg-accent">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Link>
  );
}

function Indicator({ label, value, to }: { label: string; value: string; to: string }) {
  return (
    <Link to={to} className="border border-border rounded-lg p-3 hover:bg-accent transition-colors block">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight min-h-[24px]">{label}</div>
      <div className="text-base font-semibold mt-1 truncate">{value}</div>
      <div className="text-[10px] text-primary mt-1">Show →</div>
    </Link>
  );
}
