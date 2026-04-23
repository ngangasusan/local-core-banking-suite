import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/ledger")({
  head: () => ({ meta: [{ title: "General Ledger — CoreBank" }, { name: "description", content: "Trial balance and double-entry summary." }] }),
  component: LedgerPage,
});

function LedgerPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const { data } = useQuery({
    queryKey: ["ledger"],
    enabled: !!user,
    queryFn: async () => {
      const [a, l, t] = await Promise.all([
        supabase.from("accounts").select("balance"),
        supabase.from("loans").select("outstanding_balance,status"),
        supabase.from("transactions").select("amount,txn_type"),
      ]);
      const customerDeposits = (a.data ?? []).reduce((s, r) => s + Number(r.balance || 0), 0);
      const loansReceivable = (l.data ?? [])
        .filter((r) => ["disbursed", "active", "in_arrears"].includes(r.status))
        .reduce((s, r) => s + Number(r.outstanding_balance || 0), 0);
      const interestIncome = (t.data ?? [])
        .filter((r) => r.txn_type === "interest" || r.txn_type === "fee")
        .reduce((s, r) => s + Number(r.amount || 0), 0);
      return { customerDeposits, loansReceivable, interestIncome };
    },
  });

  if (loading || !user) return null;

  const rows = [
    { code: "1100", account: "Cash & equivalents", debit: data?.customerDeposits ?? 0, credit: 0 },
    { code: "1200", account: "Loans receivable", debit: data?.loansReceivable ?? 0, credit: 0 },
    { code: "2100", account: "Customer deposits", debit: 0, credit: data?.customerDeposits ?? 0 },
    { code: "4100", account: "Interest & fee income", debit: 0, credit: data?.interestIncome ?? 0 },
  ];
  const totalDr = rows.reduce((s, r) => s + r.debit, 0);
  const totalCr = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader title="General Ledger" description="Live trial balance derived from your operations." />
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Code</th>
                <th className="text-left px-4 py-3 font-medium">Account</th>
                <th className="text-right px-4 py-3 font-medium">Debit</th>
                <th className="text-right px-4 py-3 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-3">{r.account}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.debit ? fmt(r.debit) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.credit ? fmt(r.credit) : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-4 py-3" colSpan={2}>Totals</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(totalDr)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(totalCr)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Note: a full chart-of-accounts and journal-entry log can be added on top of this view in a follow-up iteration.
        </p>
      </div>
    </AppShell>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}
