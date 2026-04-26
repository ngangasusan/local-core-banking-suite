import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type LoanLite = {
  id: string;
  loan_number: string;
  principal: number | string;
  interest_rate: number | string;
  term_months: number;
  method: string;
  status: string;
  outstanding_balance: number | string;
  due_date: string | null;
  disbursement_date: string | null;
  customer?: { full_name: string; customer_number: string } | null;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 2 }).format(n);
}

function computeTotalDue(principal: number, rate: number, termMonths: number, method: string) {
  // Simple/flat: principal * (1 + r * t/12). For reducing/amortized we approximate with same flat formula
  // for the "amount to be paid" headline (principal + interest over the term).
  const years = termMonths / 12;
  if (method === "amortized" || method === "reducing_balance") {
    // Amortized total: monthly payment * months. Use standard amortization; if rate=0 → principal.
    const r = rate / 100 / 12;
    if (r === 0) return principal;
    const m = (principal * r) / (1 - Math.pow(1 + r, -termMonths));
    return m * termMonths;
  }
  // flat
  return principal * (1 + (rate / 100) * years);
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
  const rate = Number(loan.interest_rate);
  const totalDue = computeTotalDue(principal, rate, loan.term_months, loan.method);
  const interest = totalDue - principal;
  const activePayments = payments.filter((p) => !p.reversed);
  const paymentsCount = activePayments.length;
  const paidSum = activePayments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Loan {loan.loan_number} — {loan.customer?.full_name ?? "—"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Principal" value={fmt(principal)} />
          <Stat label="Interest" value={fmt(interest)} />
          <Stat label="Total payable" value={fmt(totalDue)} highlight />
          <Stat label="Paid to date" value={fmt(paidSum)} />
          <Stat label="Outstanding" value={fmt(Number(loan.outstanding_balance))} />
          <Stat label="Payments made" value={String(paymentsCount)} />
          <Stat label="Rate" value={`${rate}% (${loan.method.replace("_", " ")})`} />
          <Stat label="Term" value={`${loan.term_months} months`} />
          <Stat label="Due date" value={loan.due_date ?? "—"} />
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium mb-2">Payment history ({paymentsCount})</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Reference</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No payments yet.</td></tr>
                )}
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={"rounded-lg border border-border p-3 " + (highlight ? "bg-primary-soft" : "bg-card")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"font-mono " + (highlight ? "text-primary font-semibold" : "")}>{value}</div>
    </div>
  );
}
