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

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "Accounts — CoreBank" }, { name: "description", content: "Savings, current and fixed-deposit accounts." }] }),
  component: AccountsPage,
});

function AccountsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*, customer:customers!accounts_customer_fk(full_name, customer_number)")
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
      const data = Object.fromEntries(fd.entries()) as Record<string, string>;
      const account_number = "A" + Date.now().toString().slice(-10);
      const { error } = await supabase.from("accounts").insert({
        account_number,
        customer_id: data.customer_id,
        account_type: data.account_type as "savings" | "current" | "fixed_deposit" | "loan",
        interest_rate: data.interest_rate ? Number(data.interest_rate) : 0,
        balance: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Account opened");
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Accounts"
          description="Customer deposit and loan accounts."
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Open account</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Open new account</DialogTitle></DialogHeader>
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(new FormData(e.currentTarget)); }}>
                  <div className="space-y-2">
                    <Label>Customer</Label>
                    <Select name="customer_id" required>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name} ({c.customer_number})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account type</Label>
                    <Select name="account_type" defaultValue="savings">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="savings">Savings</SelectItem>
                        <SelectItem value="current">Current</SelectItem>
                        <SelectItem value="fixed_deposit">Fixed Deposit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="interest_rate">Interest rate (% p.a.)</Label>
                    <Input id="interest_rate" name="interest_rate" type="number" step="0.01" defaultValue="5" />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? "Opening…" : "Open account"}</Button>
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
                <th className="text-left px-4 py-3 font-medium">Account #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No accounts yet.</td></tr>}
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{a.account_number}</td>
                  <td className="px-4 py-3">{a.customer?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{a.account_type.replace("_", " ")}</td>
                  <td className="px-4 py-3"><Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge></td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(Number(a.balance))}</td>
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
