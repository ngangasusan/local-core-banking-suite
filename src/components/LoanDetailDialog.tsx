import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { computeTotalDue, loanDaysElapsed } from "@/lib/loan-calc";

type LoanLite = {
  id: string;
  loan_number: string;
  principal: number | string;
  status: string;
  outstanding_balance: number | string;
  due_date: string | null;
  disbursement_date: string | null;
  projected_payment_date?: string | null;
  late_fees?: number | string | null;
  customer?: { full_name: string; customer_number: string } | null;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(n);
}

export function LoanDetailDialog({ loan, open, onOpenChange }: { loan: LoanLite | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: payments = [] } = useQuery({
    queryKey: ["repayments", loan?.id],
    enabled: !!loan?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_repayments")
        .select("id, amount, reference, paid_at, reversed, reversal_reason")
        .eq("loan_id", loan!.id)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!loan) return null;
  const principal = Number(loan.principal);
  const days = loanDaysElapsed(loan.disbursement_date);
  const { interest, mpesa, lateFee, total } = computeTotalDue(principal, days, loan.due_date);
  const activePayments = payments.filter((p) => !p.reversed);
  const paymentsCount = activePayments.length;
  const paidSum = activePayments.reduce((s, p) => s + Number(p.amount), 0);
  const remainingToSettle = Math.max(total - paidSum, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Loan {loan.loan_number} — {loan.customer?.full_name ?? "—"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Principal" value={fmt(principal)} />
          <Stat label={`Interest (day ${days})`} value={fmt(interest)} />
          {lateFee > 0 && <Stat label="Late fees" value={fmt(lateFee)} tone="danger" />}
          <Stat label="Total payable" value={fmt(total)} highlight />
          <Stat label="Paid to date" value={fmt(paidSum)} />
          <Stat label="Remaining to settle" value={fmt(remainingToSettle)} highlight />
          <Stat label="Principal outstanding" value={fmt(Number(loan.outstanding_balance))} />
          <Stat label="Payments made" value={String(paymentsCount)} />
          {mpesa > 0 && <Stat label="M-Pesa charge (≤5d)" value={fmt(mpesa)} />}
          <Stat label="Disbursed" value={loan.disbursement_date ?? "—"} />
          <Stat label="Due date" value={loan.due_date ?? "—"} />
          {loan.projected_payment_date && <Stat label="Projected payment" value={loan.projected_payment_date} />}
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          Rule: minimum interest 10% of principal; daily 20 per 1,000 from day 1; capped at 30% after 14 days.
          {days <= 5 && " M-Pesa send charge included while still within 5 days."}
          {lateFee > 0 && " Late penalty: 1% of principal per day past due (no cap)."}
        </p>

        <div className="mt-4">
          <h3 className="text-sm font-medium mb-2">Payment history ({paymentsCount} payment{paymentsCount === 1 ? "" : "s"})</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Reference</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No payments yet.</td></tr>
                )}
                {payments.map((p, i) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{payments.length - i}</td>
                    <td className="px-3 py-2">{new Date(p.paid_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.reference}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(p.amount))}</td>
                    <td className="px-3 py-2">
                      {p.reversed
                        ? <span className="text-destructive text-xs">Reversed{p.reversal_reason ? ` — ${p.reversal_reason}` : ""}</span>
                        : <span className="text-success text-xs">Posted</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight, tone }: { label: string; value: string; highlight?: boolean; tone?: "danger" }) {
  const bg = tone === "danger" ? "bg-destructive/10 border-destructive/30" : highlight ? "bg-primary-soft" : "bg-card";
  const txt = tone === "danger" ? "text-destructive font-semibold" : highlight ? "text-primary font-semibold" : "";
  return (
    <div className={"rounded-lg border border-border p-3 " + bg}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"font-mono " + txt}>{value}</div>
    </div>
  );
}
