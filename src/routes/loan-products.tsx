import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Scale } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { sql } from "@/lib/sql-client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { fmtKES } from "@/lib/format";

export const Route = createFileRoute("/loan-products")({
  head: () => ({ meta: [{ title: "Loan Products — CoreBank" }] }),
  component: LoanProductsPage,
});

type ProductForm = {
  id?: string;
  code: string;
  name: string;
  description: string;
  method: "flat" | "reducing_balance" | "daily_accrual";
  min_principal: number;
  max_principal: number;
  interest_rate: number;
  min_term_months: number;
  max_term_months: number;
  min_principal_pct: number;
  daily_interest_rate: number;
  late_fee_daily_pct: number;
  grace_period_days: number;
  mpesa_fee_threshold: number;
  mpesa_fee_amount: number;
  early_repayment_days: number;
  required_credit_score: number;
  is_active: boolean;
  tier1_days: number;
  tier2_days: number;
  daily_per_1000: number;
  monthly_days: number;
  monthly_pct: number;
};

const empty: ProductForm = {
  code: "", name: "", description: "", method: "reducing_balance",
  min_principal: 500, max_principal: 100000, interest_rate: 0.2,
  min_term_months: 1, max_term_months: 12, min_principal_pct: 0.1,
  daily_interest_rate: 0.02, late_fee_daily_pct: 0.01, grace_period_days: 0,
  mpesa_fee_threshold: 10000, mpesa_fee_amount: 0, early_repayment_days: 5,
  required_credit_score: 500, is_active: true,
  tier1_days: 5, tier2_days: 14, daily_per_1000: 20, monthly_days: 30, monthly_pct: 0.3,
};


function LoanProductsPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(empty);

  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  const canManage = hasRole("admin") || hasRole("super_admin") || hasRole("manager");

  const { data: products = [] } = useQuery({
    queryKey: ["loan-products"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sql
        .from("loan_products" as any).select("*").order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const save = useMutation({
    mutationFn: async (p: ProductForm) => {
      const payload = { ...p };
      if (p.id) {
        const { id, ...rest } = payload;
        const { error } = await sql.from("loan_products" as any).update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await sql.from("loan_products" as any).insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loan-products"] });
      setOpen(false);
      setForm(empty);
      toast.success("Loan product saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sql.from("loan_products" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loan-products"] });
      toast.success("Loan product deleted");
    },
    onError: (e: any) => toast.error(e.message ?? "Cannot delete (in use?)"),
  });

  const startNew = () => { setForm(empty); setOpen(true); };
  const startEdit = (p: any) => {
    setForm({
      id: p.id, code: p.code, name: p.name, description: p.description ?? "",
      method: p.method, min_principal: Number(p.min_principal), max_principal: Number(p.max_principal),
      interest_rate: Number(p.interest_rate), min_term_months: p.min_term_months, max_term_months: p.max_term_months,
      min_principal_pct: Number(p.min_principal_pct), daily_interest_rate: Number(p.daily_interest_rate),
      late_fee_daily_pct: Number(p.late_fee_daily_pct), grace_period_days: p.grace_period_days,
      mpesa_fee_threshold: Number(p.mpesa_fee_threshold), mpesa_fee_amount: Number(p.mpesa_fee_amount),
      early_repayment_days: p.early_repayment_days, required_credit_score: p.required_credit_score,
      is_active: p.is_active,
    });
    setOpen(true);
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Loan Products"
        description="Define loan categories with their own limits, rates, fees, and rules. Products are referenced when creating loans."
        actions={
          canManage ? (
            <Button onClick={startNew}><Plus className="h-4 w-4 mr-2" /> New Product</Button>
          ) : null
        }
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Principal Range</TableHead>
              <TableHead>Term (mo)</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Min Score</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                No loan products yet.
              </TableCell></TableRow>
            )}
            {products.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell><Badge variant="outline">{p.method}</Badge></TableCell>
                <TableCell className="text-xs">{fmtKES(Number(p.min_principal))} – {fmtKES(Number(p.max_principal))}</TableCell>
                <TableCell>{p.min_term_months}–{p.max_term_months}</TableCell>
                <TableCell>{(Number(p.interest_rate) * 100).toFixed(1)}%</TableCell>
                <TableCell>{p.required_credit_score}</TableCell>
                <TableCell>
                  {p.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => {
                      if (confirm(`Delete product "${p.name}"?`)) remove.mutate(p.id);
                    }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Loan Product" : "New Loan Product"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="col-span-1">
              <Label>Code</Label>
              <Input value={form.code} required onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="col-span-1">
              <Label>Name</Label>
              <Input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v: any) => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="reducing_balance">Reducing balance</SelectItem>
                  <SelectItem value="daily_accrual">Daily accrual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Interest rate (decimal, e.g. 0.2 = 20%)</Label>
              <Input type="number" step="0.001" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Min principal (KES)</Label>
              <Input type="number" value={form.min_principal} onChange={(e) => setForm({ ...form, min_principal: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Max principal (KES)</Label>
              <Input type="number" value={form.max_principal} onChange={(e) => setForm({ ...form, max_principal: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Min term (months)</Label>
              <Input type="number" value={form.min_term_months} onChange={(e) => setForm({ ...form, min_term_months: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Max term (months)</Label>
              <Input type="number" value={form.max_term_months} onChange={(e) => setForm({ ...form, max_term_months: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Min principal pct charged</Label>
              <Input type="number" step="0.01" value={form.min_principal_pct} onChange={(e) => setForm({ ...form, min_principal_pct: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Daily interest rate</Label>
              <Input type="number" step="0.0001" value={form.daily_interest_rate} onChange={(e) => setForm({ ...form, daily_interest_rate: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Late fee per day (pct of principal)</Label>
              <Input type="number" step="0.001" value={form.late_fee_daily_pct} onChange={(e) => setForm({ ...form, late_fee_daily_pct: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Grace period (days)</Label>
              <Input type="number" value={form.grace_period_days} onChange={(e) => setForm({ ...form, grace_period_days: Number(e.target.value) })} />
            </div>
            <div>
              <Label>M-Pesa fee threshold</Label>
              <Input type="number" value={form.mpesa_fee_threshold} onChange={(e) => setForm({ ...form, mpesa_fee_threshold: Number(e.target.value) })} />
            </div>
            <div>
              <Label>M-Pesa fee amount</Label>
              <Input type="number" value={form.mpesa_fee_amount} onChange={(e) => setForm({ ...form, mpesa_fee_amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Early repayment window (days)</Label>
              <Input type="number" value={form.early_repayment_days} onChange={(e) => setForm({ ...form, early_repayment_days: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Required credit score</Label>
              <Input type="number" value={form.required_credit_score} onChange={(e) => setForm({ ...form, required_credit_score: Number(e.target.value) })} />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <Label>Active</Label>
            </div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </div>
    </AppShell>
  );
}
