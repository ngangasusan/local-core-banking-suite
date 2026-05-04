import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { computeInterest, computeTotalDue, loanDaysElapsed } from "@/lib/loan-calc";
import { toast } from "sonner";

type LoanForRepayment = {
  id: string;
  loan_number: string;
  outstanding: number;
  principal: number;
  customer_id: string;
  disbursement_date: string | null;
  due_date?: string | null;
};

export function RepaymentDialog({ loan }: { loan: LoanForRepayment }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const { user } = useAuth();
  const qc = useQueryClient();

  const days = loanDaysElapsed(loan.disbursement_date);
  const accruedInterest = computeInterest(loan.principal, days);
  const { total: totalDue, lateFee } = computeTotalDue(loan.principal, days, loan.due_date ?? null);
  // remaining = total payable - (principal already paid down) = totalDue - (principal - outstanding)
  const principalPaid = loan.principal - loan.outstanding;
  const remainingToSettle = Math.max(totalDue - principalPaid, 0);
  const numAmount = Number(amount) || 0;
  // Detect "interest-only" payment: within 5% of accrued interest and clearly less than full remaining.
  const isInterestOnly =
    numAmount > 0 &&
    Math.abs(numAmount - accruedInterest) / accruedInterest <= 0.05 &&
    numAmount < remainingToSettle * 0.5;

  const post = useMutation({
    mutationFn: async ({ rollover }: { rollover: boolean }) => {
      if (numAmount <= 0) throw new Error("Amount must be positive");
      if (numAmount > remainingToSettle + 0.01) throw new Error("Amount exceeds total payable");
      const reference = "RP" + Date.now().toString().slice(-9);
      const { error: rerr } = await supabase.from("loan_repayments").insert({
        loan_id: loan.id, amount: numAmount, reference, posted_by: user!.id,
      });
      if (rerr) throw rerr;
      await supabase.from("transactions").insert({
        reference, txn_type: "loan_repayment", amount: numAmount,
        description: `Repayment for ${loan.loan_number}${rollover ? " (interest only — rolling over principal)" : ""}`,
        performed_by: user!.id,
      });
      // GL postings (split by penalty / fees / interest / principal) are handled by the
      // apply_repayment trigger using the waterfall allocation.

      // Rollover: create a new loan with same principal, fresh 30-day term.
      if (rollover) {
        const newNumber = "L" + Date.now().toString().slice(-9);
        const { error: lerr } = await supabase.from("loans").insert({
          loan_number: newNumber,
          customer_id: loan.customer_id,
          principal: loan.principal,
          interest_rate: 0, // calc engine ignores this; rules are fixed
          term_months: 1,
          method: "flat",
          purpose: `Rollover from ${loan.loan_number}`,
          outstanding_balance: loan.principal,
          status: "approved",
          rollover_of: loan.id,
          created_by: user!.id,
          approved_by: user!.id,
        });
        if (lerr) throw lerr;
        // Auto-disburse the rolled-over loan (trigger sets due_date and activates).
        const { data: created } = await supabase.from("loans").select("id").eq("loan_number", newNumber).single();
        if (created) {
          await supabase.from("loans").update({ status: "disbursed" }).eq("id", created.id);
        }
      }
    },
    onSuccess: () => {
      toast.success("Repayment posted");
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["repayments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["customer-loans"] });
      setOpen(false);
      setAmount("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Pay</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Post repayment — {loan.loan_number}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); post.mutate({ rollover: false }); }}>
          <div className="text-xs space-y-1 text-muted-foreground">
            <div>Principal outstanding: <span className="font-mono">{loan.outstanding.toLocaleString()}</span></div>
            <div>Accrued interest (day {days}): <span className="font-mono">{accruedInterest.toLocaleString()}</span></div>
            {lateFee > 0 && <div className="text-destructive">Late penalty fees: <span className="font-mono">{lateFee.toLocaleString()}</span></div>}
            <div className="text-foreground font-medium">Remaining to settle: <span className="font-mono">{remainingToSettle.toLocaleString()}</span></div>
          </div>
          <div className="space-y-2">
            <Label>Amount (KES)</Label>
            <Input name="amount" type="number" step="0.01" required max={remainingToSettle} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {isInterestOnly && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
              <p className="font-medium mb-1">Interest-only payment detected.</p>
              <p>Roll over the principal ({loan.principal.toLocaleString()}) as a new loan?</p>
              <div className="flex gap-2 mt-2">
                <Button type="button" size="sm" onClick={() => post.mutate({ rollover: true })} disabled={post.isPending}>
                  Yes, roll over
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => post.mutate({ rollover: false })} disabled={post.isPending}>
                  No, just post
                </Button>
              </div>
            </div>
          )}
          {!isInterestOnly && (
            <DialogFooter>
              <Button type="submit" disabled={post.isPending}>{post.isPending ? "Posting…" : "Post repayment"}</Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
