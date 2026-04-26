import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions — CoreBank" }, { name: "description", content: "Deposits, withdrawals and transfers." }] }),
  component: TxnPage,
});

function TxnPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"deposit" | "withdrawal" | "transfer" | "loan_repayment">("deposit");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: txns = [] } = useQuery({
    queryKey: ["transactions"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, account:accounts!transactions_account_id_fkey(account_number, customer:customers(full_name))")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts-min"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, account_number, balance, customer:customers(full_name)").eq("status", "active");
      return data ?? [];
    },
  });

  const { data: activeLoans = [] } = useQuery({
    queryKey: ["loans-active-min"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, outstanding_balance, customer:customers(full_name)")
        .in("status", ["active", "in_arrears"])
        .gt("outstanding_balance", 0)
        .order("loan_number");
      return data ?? [];
    },
  });

  const post = useMutation({
    mutationFn: async (fd: FormData) => {
      const d = Object.fromEntries(fd.entries()) as Record<string, string>;
      const amount = Number(d.amount);
      if (amount <= 0) throw new Error("Amount must be positive");
      const reference = "TX" + Date.now();

      // Loan repayment branch — uses repayments table; trigger reduces balance + recomputes credit score
      if (type === "loan_repayment") {
        const loan = activeLoans.find((l) => l.id === d.loan_id);
        if (!loan) throw new Error("Select a loan");
        if (amount > Number(loan.outstanding_balance)) throw new Error("Amount exceeds outstanding balance");
        const ref = "RP" + Date.now().toString().slice(-9);
        const { error: rerr } = await supabase.from("loan_repayments").insert({
          loan_id: d.loan_id, amount, reference: ref, posted_by: user!.id,
        });
        if (rerr) throw rerr;
        const { error: terr } = await supabase.from("transactions").insert({
          reference: ref, txn_type: "loan_repayment", amount,
          description: d.description || `Repayment for ${loan.loan_number}`,
          performed_by: user!.id,
        });
        if (terr) throw terr;
        // GL: Cash Dr / Loans Receivable Cr
        const { data: coa } = await supabase.from("chart_of_accounts").select("id, code").in("code", ["1000", "1100"]);
        const cash = coa?.find((c) => c.code === "1000")?.id;
        const loanRec = coa?.find((c) => c.code === "1100")?.id;
        if (cash && loanRec) {
          await supabase.from("journal_entries").insert({
            reference: ref, description: `Repayment ${loan.loan_number}`,
            debit_account: cash, credit_account: loanRec, amount,
            source_table: "loan_repayments", source_id: null, created_by: user!.id,
          });
        }
        return;
      }

      const acct = accounts.find((a) => a.id === d.account_id);
      if (!acct) throw new Error("Account not found");
      const curBal = Number(acct.balance);
      let newBal = curBal;
      if (type === "deposit") newBal = curBal + amount;
      else if (type === "withdrawal") {
        if (curBal < amount) throw new Error("Insufficient balance");
        newBal = curBal - amount;
      }

      // Update primary account
      const { error: u1 } = await supabase.from("accounts").update({ balance: newBal }).eq("id", d.account_id);
      if (u1) throw u1;

      // Transfer: update counterparty
      let counterparty_account_id: string | null = null;
      if (type === "transfer") {
        const counter = accounts.find((a) => a.id === d.counterparty_account_id);
        if (!counter) throw new Error("Destination account not found");
        if (curBal < amount) throw new Error("Insufficient balance");
        await supabase.from("accounts").update({ balance: curBal - amount }).eq("id", d.account_id);
        await supabase.from("accounts").update({ balance: Number(counter.balance) + amount }).eq("id", d.counterparty_account_id);
        counterparty_account_id = d.counterparty_account_id;
      }

      const { error } = await supabase.from("transactions").insert({
        reference,
        txn_type: type,
        amount,
        account_id: d.account_id,
        counterparty_account_id,
        description: d.description || null,
        performed_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transaction posted");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-min"] });
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-active-min"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Transactions"
          description="Cash deposits, withdrawals and internal transfers."
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New transaction</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Post transaction</DialogTitle></DialogHeader>
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); post.mutate(new FormData(e.currentTarget)); }}>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deposit">Deposit</SelectItem>
                        <SelectItem value="withdrawal">Withdrawal</SelectItem>
                        <SelectItem value="transfer">Internal transfer</SelectItem>
                        <SelectItem value="loan_repayment">Loan repayment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {type === "loan_repayment" ? (
                    <div className="space-y-2">
                      <Label>Loan</Label>
                      <Select name="loan_id" required>
                        <SelectTrigger><SelectValue placeholder="Select loan" /></SelectTrigger>
                        <SelectContent>
                          {activeLoans.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.loan_number} — {l.customer?.full_name} (bal {fmt(Number(l.outstanding_balance))})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>{type === "transfer" ? "Source account" : "Account"}</Label>
                      <Select name="account_id" required>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.account_number} — {a.customer?.full_name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {type === "transfer" && (
                    <div className="space-y-2">
                      <Label>Destination account</Label>
                      <Select name="counterparty_account_id" required>
                        <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.account_number} — {a.customer?.full_name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2"><Label>Amount (KES)</Label><Input name="amount" type="number" step="0.01" required /></div>
                  <div className="space-y-2"><Label>Description</Label><Input name="description" /></div>
                  <DialogFooter><Button type="submit" disabled={post.isPending}>{post.isPending ? "Posting…" : "Post"}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Reference</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Account</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No transactions yet.</td></tr>}
              {txns.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{t.reference}</td>
                  <td className="px-4 py-3 capitalize">{t.txn_type.replace("_", " ")}</td>
                  <td className="px-4 py-3">{t.account?.account_number} {t.account?.customer && <span className="text-muted-foreground">— {t.account.customer.full_name}</span>}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(t.amount))}</td>
                  <td className="px-4 py-3"><Badge variant={t.status === "completed" ? "default" : "secondary"}>{t.status}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(n);
}
