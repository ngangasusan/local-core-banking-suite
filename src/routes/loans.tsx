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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans — CoreBank" }, { name: "description", content: "Loan origination, approval and disbursement." }] }),
  component: LoansPage,
});

function LoansPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: loans = [] } = useQuery({
    queryKey: ["loans"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loans")
        .select("*, customer:customers(full_name, customer_number)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-min"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, full_name, customer_number").order("full_name");
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async (fd: FormData) => {
      const d = Object.fromEntries(fd.entries()) as Record<string, string>;
      const principal = Number(d.principal);
      const loan_number = "L" + Date.now().toString().slice(-9);
      const { error } = await supabase.from("loans").insert({
        loan_number,
        customer_id: d.customer_id,
        principal,
        interest_rate: Number(d.interest_rate),
        term_months: Number(d.term_months),
        method: d.method as "flat" | "reducing_balance" | "amortized",
        purpose: d.purpose || null,
        outstanding_balance: principal,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan application submitted");
      qc.invalidateQueries({ queryKey: ["loans"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" | "disbursed" }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "approved") patch.approved_by = user!.id;
      if (status === "disbursed") {
        patch.approved_by = user!.id;
        patch.disbursed_at = new Date().toISOString();
      }
      const { error } = await supabase.from("loans").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loan updated");
      qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) return null;
  const canApprove = hasRole("admin") || hasRole("manager");

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Loans"
          description="Originate, approve and track the loan portfolio."
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New loan</Button></DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>Loan application</DialogTitle></DialogHeader>
                <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(new FormData(e.currentTarget)); }}>
                  <div className="col-span-2 space-y-2">
                    <Label>Customer</Label>
                    <Select name="customer_id" required>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name} ({c.customer_number})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Principal (KES)</Label><Input name="principal" type="number" step="0.01" required /></div>
                  <div className="space-y-2"><Label>Term (months)</Label><Input name="term_months" type="number" required defaultValue={12} /></div>
                  <div className="space-y-2"><Label>Interest rate (%)</Label><Input name="interest_rate" type="number" step="0.01" required defaultValue={14} /></div>
                  <div className="space-y-2">
                    <Label>Method</Label>
                    <Select name="method" defaultValue="reducing_balance">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reducing_balance">Reducing balance</SelectItem>
                        <SelectItem value="flat">Flat</SelectItem>
                        <SelectItem value="amortized">Amortized</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2"><Label>Purpose</Label><Textarea name="purpose" rows={2} /></div>
                  <DialogFooter className="col-span-2">
                    <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? "Submitting…" : "Submit application"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Loan #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-right px-4 py-3 font-medium">Principal</th>
                <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                <th className="text-left px-4 py-3 font-medium">Term</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No loans yet.</td></tr>}
              {loans.map((l) => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{l.loan_number}</td>
                  <td className="px-4 py-3">{l.customer?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.principal))}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(l.outstanding_balance))}</td>
                  <td className="px-4 py-3">{l.term_months}m @ {l.interest_rate}%</td>
                  <td className="px-4 py-3"><LoanStatusBadge status={l.status} /></td>
                  <td className="px-4 py-3 text-right">
                    {canApprove && l.status === "pending" && (
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: l.id, status: "approved" })}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: l.id, status: "rejected" })}>Reject</Button>
                      </div>
                    )}
                    {canApprove && l.status === "approved" && (
                      <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: l.id, status: "disbursed" })}>Disburse</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function LoanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-warning/15 text-warning-foreground",
    approved: "bg-primary-soft text-primary",
    disbursed: "bg-success/15 text-success",
    active: "bg-success/15 text-success",
    in_arrears: "bg-destructive/15 text-destructive",
    rejected: "bg-muted text-muted-foreground",
    closed: "bg-muted text-muted-foreground",
  };
  return <span className={"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize " + (map[status] ?? "bg-muted")}>{status.replace("_", " ")}</span>;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}
