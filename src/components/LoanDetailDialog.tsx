import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { sql } from "@/lib/sql-client";
import { computeTotalDue, loanDaysElapsed, rulesFromProduct } from "@/lib/loan-calc";
import { fmtKES as _fmtKES, fmtDate } from "@/lib/format";

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
  product_id?: string | null;
  rollover_of?: string | null;
  customer?: { full_name: string; customer_number: string } | null;
};

const fmt = _fmtKES;

export function LoanDetailDialog({ loan, open, onOpenChange }: { loan: LoanLite | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [showSteps, setShowSteps] = useState(false);

  const { data: payments = [] } = useQuery({
    queryKey: ["repayments", loan?.id],
    enabled: !!loan?.id && open,
    queryFn: async () => {
      const { data, error } = await sql
        .from("loan_repayments")
        .select("id, amount, reference, paid_at, reversed, reversal_reason")
        .eq("loan_id", loan!.id)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: product } = useQuery({
    queryKey: ["loan-product", loan?.product_id],
    enabled: !!loan?.product_id && open,
    queryFn: async () => {
      const { data } = await sql.from("loan_products" as any).select("*").eq("id", loan!.product_id).maybeSingle();
      return data as any;
    },
  });

  // Rollover relationship: the loan this one came from, and loans rolled over from this one.
  const { data: parentLoan } = useQuery({
    queryKey: ["loan-parent", loan?.rollover_of],
    enabled: !!loan?.rollover_of && open,
    queryFn: async () => {
      const { data } = await sql.from("loans").select("id, loan_number, principal, status, disbursement_date, due_date").eq("id", loan!.rollover_of as string).maybeSingle();
      return data as any;
    },
  });

  const { data: childLoans = [] } = useQuery({
    queryKey: ["loan-children", loan?.id],
    enabled: !!loan?.id && open,
    queryFn: async () => {
      const { data } = await sql.from("loans").select("id, loan_number, principal, status, disbursement_date, due_date").eq("rollover_of", loan!.id);
      return (data ?? []) as any[];
    },
  });

  if (!loan) return null;
  const principal = Number(loan.principal);
  const days = loanDaysElapsed(loan.disbursement_date);
  const rules = rulesFromProduct(product);
  const { interest, mpesa, lateFee, total, breakdown } = computeTotalDue(principal, days, loan.due_date, rules);
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
          <Stat label="Disbursed" value={fmtDate(loan.disbursement_date)} />
          <Stat label="Due date" value={fmtDate(loan.due_date)} />
          {loan.projected_payment_date && <Stat label="Projected payment" value={fmtDate(loan.projected_payment_date)} />}
        </div>

        {/* Interest breakdown */}
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              Interest breakdown
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground"><Info className="h-3.5 w-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <ol className="list-decimal ml-4 space-y-0.5 text-xs">
                      {breakdown.steps.map((s, i) => (<li key={i}>{s}</li>))}
                    </ol>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h3>
            <Button size="sm" variant="outline" onClick={() => setShowSteps(true)}>Show calculation</Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Tier {breakdown.tier} ({breakdown.tierLabel}){breakdown.months > 0 ? ` · ${breakdown.months} month${breakdown.months === 1 ? "" : "s"} charged` : ""}
            {product ? ` · product ${product.name}` : " · default product rules"}
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Line label="Principal" value={fmt(principal)} />
            <Line label="Interest" value={fmt(interest)} />
            {mpesa > 0 && <Line label="M-Pesa charge" value={fmt(mpesa)} />}
            {lateFee > 0 && <Line label="Late penalty" value={fmt(lateFee)} />}
            <Line label="Total payable" value={fmt(total)} strong />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Rule: 0–{rules.tier1_days} days → {(rules.min_principal_pct * 100).toFixed(0)}% minimum;
            {" "}{rules.tier1_days + 1}–{rules.tier2_days} days → MAX(minimum, {rules.daily_per_1000} per 1,000 per day);
            {" "}{rules.tier2_days + 1} days and beyond → {(rules.monthly_pct * 100).toFixed(0)}% per {rules.monthly_days}-day month.
            {lateFee > 0 && " Late penalty: 1% of principal per day past due."}
          </p>
        </div>

        {/* Rollover relationship */}
        {(parentLoan || childLoans.length > 0) && (
          <div className="mt-4 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium mb-2">Rollover history</h3>
            <div className="space-y-1 text-xs">
              {parentLoan && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Rolled over from</span>
                  <span className="font-mono">
                    {parentLoan.loan_number} · {fmt(Number(parentLoan.principal))} · {parentLoan.status} · disbursed {fmtDate(parentLoan.disbursement_date)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">This loan</span>
                <span className="font-mono">{loan.loan_number} · {fmt(principal)} · {loan.status}</span>
              </div>
              {childLoans.map((c) => (
                <div key={c.id} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Rolled over into</span>
                  <span className="font-mono">
                    {c.loan_number} · {fmt(Number(c.principal))} · {c.status} · due {fmtDate(c.due_date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                    <td className="px-3 py-2">{fmtDate(p.paid_at)}</td>
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

        <Dialog open={showSteps} onOpenChange={setShowSteps}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Interest calculation — {loan.loan_number}</DialogTitle></DialogHeader>
            <ol className="list-decimal ml-5 space-y-1 text-sm">
              {breakdown.steps.map((s, i) => (<li key={i}>{s}</li>))}
              {mpesa > 0 && <li>M-Pesa send charge (within {rules.tier1_days} days): {fmt(mpesa)}</li>}
              {lateFee > 0 && <li>Late penalty (1% of principal per day past due): {fmt(lateFee)}</li>}
              <li className="font-medium">Total payable: {fmt(principal)} + {fmt(interest + mpesa + lateFee)} = {fmt(total)}</li>
            </ol>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={"font-mono " + (strong ? "font-semibold text-primary" : "")}>{value}</span>
    </div>
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
