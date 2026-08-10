import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { sql } from "@/lib/sql-client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/Pagination";
import { fmtKES as fmt } from "@/lib/format";

export const Route = createFileRoute("/repayments")({
  head: () => ({
    meta: [
      { title: "Repayments — CoreBank" },
      { name: "description", content: "Every loan repayment posted, with its waterfall allocation." },
      { property: "og:title", content: "Repayments — CoreBank" },
      { property: "og:description", content: "Every loan repayment posted, with its waterfall allocation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RepaymentsPage,
});

function RepaymentsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const { data: rows = [] } = useQuery({
    queryKey: ["all-repayments"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sql
        .from("loan_repayments")
        .select(
          "id, amount, reference, paid_at, reversed, reversal_reason, allocated_principal, allocated_interest, allocated_fees, allocated_penalty, loan:loans!loan_repayments_loan_fk(id, loan_number, customer:customers!loans_customer_fk(full_name, customer_number))"
        )
        .order("paid_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const s = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        !s
          ? true
          : String(r.reference ?? "").toLowerCase().includes(s) ||
            String(r.loan?.loan_number ?? "").toLowerCase().includes(s) ||
            String(r.loan?.customer?.full_name ?? "").toLowerCase().includes(s)
      ),
    [rows, s]
  );

  useEffect(() => { setPage(1); }, [s]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPosted = filtered.filter((r) => !r.reversed).reduce((sum, r) => sum + Number(r.amount), 0);

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Repayments"
          description="Every repayment posted from the Loans module, allocated penalty → fees → interest → principal."
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <Stat label="Payments" value={String(filtered.length)} />
          <Stat label="Total collected" value={fmt(totalPosted)} />
          <Stat label="Reversed" value={String(filtered.filter((r) => r.reversed).length)} />
        </div>

        <div className="bg-card border border-border rounded-xl">
          <div className="p-4 border-b border-border">
            <div className="relative max-w-sm">
              <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search reference, loan # or client…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Reference</th>
                  <th className="text-left px-4 py-3 font-medium">Loan #</th>
                  <th className="text-left px-4 py-3 font-medium">Client</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Principal</th>
                  <th className="text-right px-4 py-3 font-medium">Interest</th>
                  <th className="text-right px-4 py-3 font-medium">Fees / penalty</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No repayments found.</td></tr>
                )}
                {paged.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.reference}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.loan?.loan_number ?? "—"}</td>
                    <td className="px-4 py-3">{r.loan?.customer?.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(Number(r.amount))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{fmt(Number(r.allocated_principal ?? 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{fmt(Number(r.allocated_interest ?? 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {fmt(Number(r.allocated_fees ?? 0) + Number(r.allocated_penalty ?? 0))}
                    </td>
                    <td className="px-4 py-3">
                      {r.reversed
                        ? <span className="text-destructive text-xs">Reversed{r.reversal_reason ? ` — ${r.reversal_reason}` : ""}</span>
                        : <span className="text-success text-xs">Posted</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}
