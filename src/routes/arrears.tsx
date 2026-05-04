import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { LoanDetailDialog } from "@/components/LoanDetailDialog";
import { agingBucket, computeTotalDue, daysPastDue, loanDaysElapsed } from "@/lib/loan-calc";

export const Route = createFileRoute("/arrears")({
  head: () => ({ meta: [{ title: "Arrears & PAR — CoreBank" }, { name: "description", content: "Portfolio at risk: aging buckets and overdue loans." }] }),
  component: ArrearsPage,
});

const BUCKETS: { key: ReturnType<typeof agingBucket>; label: string; tone: string }[] = [
  { key: "current",     label: "Current",   tone: "bg-success/10 text-success border-success/30" },
  { key: "par_1_30",    label: "1–30 days", tone: "bg-warning/15 text-warning-foreground border-warning/30" },
  { key: "par_31_60",   label: "31–60 days",tone: "bg-warning/25 text-warning-foreground border-warning/50" },
  { key: "par_61_90",   label: "61–90 days",tone: "bg-destructive/15 text-destructive border-destructive/30" },
  { key: "par_90_plus", label: "90+ days",  tone: "bg-destructive/25 text-destructive border-destructive/50" },
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

function ArrearsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReturnType<typeof agingBucket> | "all">("all");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detailLoan, setDetailLoan] = useState<any>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: loans = [] } = useQuery({
    queryKey: ["arrears-loans"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loans")
        .select("id, loan_number, principal, outstanding_balance, due_date, disbursement_date, status, late_fees, customer:customers(full_name, customer_number, phone)")
        .in("status", ["active", "in_arrears", "disbursed"])
        .gt("outstanding_balance", 0)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading || !user) return null;

  // Compute bucket aggregates client-side from the same dataset
  const enriched = loans.map((l) => {
    const principal = Number(l.principal);
    const outstanding = Number(l.outstanding_balance);
    const bucket = agingBucket(l.due_date, outstanding);
    const dpd = daysPastDue(l.due_date);
    const days = loanDaysElapsed(l.disbursement_date);
    const { total, lateFee } = computeTotalDue(principal, days, l.due_date);
    const paid = Math.max(principal - outstanding, 0);
    const remaining = Math.max(total - paid, 0);
    return { ...l, bucket, dpd, remaining, lateFee };
  });

  const summary = BUCKETS.map((b) => {
    const rows = enriched.filter((r) => r.bucket === b.key);
    return {
      ...b,
      count: rows.length,
      outstanding: rows.reduce((s, r) => s + Number(r.outstanding_balance), 0),
      remaining: rows.reduce((s, r) => s + r.remaining, 0),
    };
  });

  const totalPortfolio = enriched.reduce((s, r) => s + Number(r.outstanding_balance), 0);
  const parAmount = enriched.filter((r) => r.bucket !== "current").reduce((s, r) => s + Number(r.outstanding_balance), 0);
  const parRatio = totalPortfolio > 0 ? (parAmount / totalPortfolio) * 100 : 0;

  const visible = filter === "all" ? enriched.filter((r) => r.bucket !== "current") : enriched.filter((r) => r.bucket === filter);

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Arrears & Portfolio at Risk"
          description="Aging buckets, overdue loans, and accruing penalty fees. PAR ratio is the share of the book past due."
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Loan portfolio</span>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-semibold">{fmt(totalPortfolio)}</div>
            <div className="text-xs text-muted-foreground mt-1">{enriched.length} open loans</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Portfolio at risk (PAR &gt; 0)</span>
              <AlertTriangle className="h-4 w-4 text-warning-foreground" />
            </div>
            <div className="text-2xl font-semibold">{fmt(parAmount)}</div>
            <div className="text-xs text-muted-foreground mt-1">{enriched.filter((r) => r.bucket !== "current").length} loans past due</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">PAR ratio</span>
              <span className={"text-xs font-mono px-2 py-0.5 rounded " + (parRatio >= 10 ? "bg-destructive/15 text-destructive" : parRatio >= 5 ? "bg-warning/20 text-warning-foreground" : "bg-success/15 text-success")}>
                {parRatio < 5 ? "Healthy" : parRatio < 10 ? "Watch" : "High"}
              </span>
            </div>
            <div className="text-2xl font-semibold">{parRatio.toFixed(2)}%</div>
            <div className="text-xs text-muted-foreground mt-1">Industry benchmark: &lt;5%</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {summary.map((b) => (
            <button
              key={b.key}
              onClick={() => setFilter(b.key)}
              className={"text-left rounded-lg border p-3 transition-all " + b.tone + (filter === b.key ? " ring-2 ring-primary" : "")}
            >
              <div className="text-[11px] uppercase tracking-wide opacity-80">{b.label}</div>
              <div className="text-lg font-semibold mt-0.5">{b.count}</div>
              <div className="text-xs font-mono opacity-80">{fmt(b.outstanding)}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">
            {filter === "all" ? "All overdue loans" : `Loans in bucket: ${BUCKETS.find((b) => b.key === filter)?.label}`}
          </h3>
          <button onClick={() => setFilter("all")} className="text-xs text-primary hover:underline">Show all overdue</button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Loan #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Phone</th>
                <th className="text-left px-4 py-3 font-medium">Due date</th>
                <th className="text-right px-4 py-3 font-medium">Days past due</th>
                <th className="text-right px-4 py-3 font-medium">Late fees</th>
                <th className="text-right px-4 py-3 font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">
                  {filter === "all" ? "No overdue loans 🎉" : "No loans in this bucket."}
                </td></tr>
              )}
              {visible.map((l) => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setDetailLoan(l)}>
                  <td className="px-4 py-3 font-mono text-xs">{l.loan_number}</td>
                  <td className="px-4 py-3">{l.customer?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.customer?.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{l.due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={"text-xs px-2 py-0.5 rounded font-medium " + (l.dpd > 60 ? "bg-destructive/15 text-destructive" : l.dpd > 0 ? "bg-warning/15 text-warning-foreground" : "bg-success/15 text-success")}>
                      {l.dpd}d
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-destructive">{l.lateFee > 0 ? fmt(l.lateFee) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(l.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Late penalty: 1% of principal per day past due (no cap). Accrued automatically every day at 01:00.
          Click a row to open the loan and post a repayment. Need to follow up?{" "}
          <Link to="/notifications" className="text-primary hover:underline">Send reminders →</Link>
        </p>

        <LoanDetailDialog loan={detailLoan} open={!!detailLoan} onOpenChange={(o) => !o && setDetailLoan(null)} />
      </div>
    </AppShell>
  );
}
