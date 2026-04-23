import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — CoreBank" }, { name: "description", content: "Portfolio at risk, aging and financial summaries." }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const { data: loans = [] } = useQuery({
    queryKey: ["report-loans"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("loans").select("*, customer:customers(full_name)");
      return data ?? [];
    },
  });

  const total = loans.reduce((s, l) => s + Number(l.outstanding_balance || 0), 0);
  const arrears = loans.filter((l) => l.status === "in_arrears");
  const arrearsTotal = arrears.reduce((s, l) => s + Number(l.outstanding_balance || 0), 0);
  const par = total > 0 ? (arrearsTotal / total) * 100 : 0;

  const exportCsv = () => {
    const rows = [
      ["loan_number", "customer", "principal", "outstanding", "status", "term_months", "rate"],
      ...loans.map((l) => [l.loan_number, l.customer?.full_name ?? "", l.principal, l.outstanding_balance, l.status, l.term_months, l.interest_rate]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `loan_portfolio_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Reports"
          description="Operational and risk reports."
          actions={<Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />Export portfolio CSV</Button>}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Stat label="Outstanding portfolio" value={fmt(total)} />
          <Stat label="Loans in arrears" value={String(arrears.length)} />
          <Stat label="Portfolio at Risk (PAR)" value={par.toFixed(2) + "%"} accent={par > 5 ? "danger" : "ok"} />
        </div>

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <div className="p-4 border-b border-border font-semibold">Loan aging</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Loan #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                <th className="text-right px-4 py-3 font-medium">Days since disbursement</th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No loans recorded.</td></tr>}
              {loans.map((l) => {
                const days = l.disbursed_at ? Math.floor((Date.now() - new Date(l.disbursed_at).getTime()) / 86400000) : 0;
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-3 font-mono text-xs">{l.loan_number}</td>
                    <td className="px-4 py-3">{l.customer?.full_name ?? "—"}</td>
                    <td className="px-4 py-3 capitalize">{l.status.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.outstanding_balance))}</td>
                    <td className="px-4 py-3 text-right">{l.disbursed_at ? days : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "ok" | "danger" }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={"text-2xl font-semibold mt-1 " + (accent === "danger" ? "text-destructive" : "")}>{value}</div>
    </div>
  );
}
function fmt(n: number) { return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n); }
