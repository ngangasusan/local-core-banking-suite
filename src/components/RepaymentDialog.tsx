import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export function RepaymentDialog({ loanId, loanNumber, outstanding }: { loanId: string; loanNumber: string; outstanding: number }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const qc = useQueryClient();

  const post = useMutation({
    mutationFn: async (fd: FormData) => {
      const amount = Number(fd.get("amount"));
      if (amount <= 0) throw new Error("Amount must be positive");
      if (amount > outstanding) throw new Error("Amount exceeds outstanding balance");
      const reference = "RP" + Date.now().toString().slice(-9);
      const { error: rerr } = await supabase.from("loan_repayments").insert({
        loan_id: loanId, amount, reference, posted_by: user!.id,
      });
      if (rerr) throw rerr;
      // Mirror to transactions for audit
      await supabase.from("transactions").insert({
        reference, txn_type: "loan_repayment", amount, description: `Repayment for ${loanNumber}`, performed_by: user!.id,
      });
      // Auto post to GL: Cash (1000) Dr / Loans Receivable (1100) Cr
      const { data: coa } = await supabase.from("chart_of_accounts").select("id, code").in("code", ["1000", "1100"]);
      const cash = coa?.find((c) => c.code === "1000")?.id;
      const loanRec = coa?.find((c) => c.code === "1100")?.id;
      if (cash && loanRec) {
        await supabase.from("journal_entries").insert({
          reference, description: `Repayment ${loanNumber}`,
          debit_account: cash, credit_account: loanRec, amount,
          source_table: "loan_repayments", source_id: null, created_by: user!.id,
        });
      }
    },
    onSuccess: () => {
      toast.success("Repayment posted");
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["repayments"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Pay</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Post repayment — {loanNumber}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); post.mutate(new FormData(e.currentTarget)); }}>
          <div className="text-sm text-muted-foreground">Outstanding: <span className="font-mono">{outstanding.toLocaleString()}</span></div>
          <div className="space-y-2">
            <Label>Amount (KES)</Label>
            <Input name="amount" type="number" step="0.01" required max={outstanding} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={post.isPending}>{post.isPending ? "Posting…" : "Post repayment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
