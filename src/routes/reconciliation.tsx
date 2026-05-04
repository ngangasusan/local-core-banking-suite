import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scale, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/reconciliation")({
  head: () => ({ meta: [{ title: "Reconciliation — CoreBank" }, { name: "description", content: "Daily cash reconciliation between transactions, repayments, and the general ledger." }] }),
  component: ReconciliationPage,
});

type Row = {
  day: string;
  transactions_cash: number | string;
  repayments_cash: number | string;
  gl_cash: number | string;
  variance_repayment_vs_txn: number | string;
  variance_repayment_vs_gl: number | string;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(n);
}

function ReconciliationPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const isPrivileged = hasRole("admin") || hasRole("super_admin") || hasRole("manager") || hasRole("auditor");

  const { data: rows = [] } = useQuery({
    queryKey: ["daily-recon"],
    enabled: !!user && isPrivileged,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("daily_recon").select("*").limit(60);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  if (loading || !user) return null;
  if (!isPrivileged) {
    return (
      <AppShell>
        <div className="p-10 text-center text-muted-foreground">You do not have access to reconciliation reports.</div>
      </AppShell>
    );
  }

  const enriched = rows.map((r) => ({
    ...r,
    transactions_cash: Number(r.transactions_cash),
    repayments_cash: Number(r.repayments_cash),
    gl_cash: Number(r.gl_cash),
    var_txn: Number(r.variance_repayment_vs_txn),
    var_gl: Number(r.variance_repayment_vs_gl),
  }));

  const cleanDays = enriched.filter((r) => Math.abs(r.var_txn) < 0.01 && Math.abs(r.var_gl) < 0.01).length;
  const variantDays = enriched.length - cleanDays;
  const totalVarTxn = enriched.reduce((s, r) => s + Math.abs(r.var_txn), 0);
  const totalVarGl = enriched.reduce((s, r) => s + Math.abs(r.var_gl), 0);

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Daily Reconciliation"
          description="Cash receipts compared across the transactions log, loan repayments, and the general ledger. Variances surface here first."
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Days reconciled</span>
              <Scale className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-semibold">{enriched.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Last 60 days of activity</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Clean days</span>
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
            <div className="text-2xl font-semibold">{cleanDays}</div>
            <div className="text-xs text-muted-foreground mt-1">Zero variance across all three sources</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Days with variance</span>
              <AlertTriangle className={"h-4 w-4 " + (variantDays > 0 ? "text-destructive" : "text-muted-foreground")} />
            </div>
            <div className="text-2xl font-semibold">{variantDays}</div>
            <div className="text-xs text-muted-foreground mt-1">|Δ txn| {fmt(totalVarTxn)} · |Δ GL| {fmt(totalVarGl)}</div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-right px-4 py-3 font-medium">Transactions cash</th>
                <th className="text-right px-4 py-3 font-medium">Repayments cash</th>
                <th className="text-right px-4 py-3 font-medium">GL cash</th>
                <th className="text-right px-4 py-3 font-medium">Δ Repay − Txn</th>
                <th className="text-right px-4 py-3 font-medium">Δ Repay − GL</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {enriched.length === 0 && (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No activity to reconcile yet.</td></tr>
              )}
              {enriched.map((r) => {
                const ok = Math.abs(r.var_txn) < 0.01 && Math.abs(r.var_gl) < 0.01;
                return (
                  <tr key={r.day} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs">{new Date(r.day).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(r.transactions_cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(r.repayments_cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(r.gl_cash)}</td>
                    <td className={"px-4 py-3 text-right font-mono " + (Math.abs(r.var_txn) > 0.01 ? "text-destructive font-semibold" : "")}>{fmt(r.var_txn)}</td>
                    <td className={"px-4 py-3 text-right font-mono " + (Math.abs(r.var_gl) > 0.01 ? "text-destructive font-semibold" : "")}>{fmt(r.var_gl)}</td>
                    <td className="px-4 py-3">
                      {ok
                        ? <span className="text-xs px-2 py-0.5 rounded bg-success/15 text-success">Balanced</span>
                        : <span className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive">Variance</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Source of truth: <span className="font-mono">daily_recon</span> view. Three legs reconciled — the transactions log (cashier
          receipts), <span className="font-mono">loan_repayments</span> (loan ledger), and journal entries debiting Cash for
          repayments. Any non-zero Δ means the books disagree and must be investigated before close-of-day.
        </p>
      </div>
    </AppShell>
  );
}
