import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search as SearchIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { sql } from "@/lib/sql-client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RepaymentDialog } from "@/components/RepaymentDialog";
import { LoanDetailDialog } from "@/components/LoanDetailDialog";
import { computeTotalDue, loanDaysElapsed, isoDate, addDays, rulesFromProduct } from "@/lib/loan-calc";
import { Pagination } from "@/components/Pagination";
import { ImportExport, type ImportResult } from "@/components/ImportExport";
import { toast } from "sonner";
import { fmtKES as _fmtKES, fmtDate } from "@/lib/format";

const LOAN_CSV_COLUMNS = [
  "loan_number", "customer_number", "customer_name", "principal", "interest_rate", "term_months",
  "method", "status", "outstanding_balance", "late_fees", "disbursement_date", "due_date", "purpose", "created_at",
];


export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans — CoreBank" }, { name: "description", content: "Loan origination, approval and disbursement." }] }),
  component: LoansPage,
});

function LoansPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [detailLoan, setDetailLoan] = useState<any | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);


  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const { data: loans = [] } = useQuery({
    queryKey: ["loans"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sql
        .from("loans")
        .select("*, customer:customers!loans_customer_fk(full_name, customer_number, kyc_status)")
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
      const { data } = await sql.from("customers").select("id, full_name, customer_number, credit_score").eq("is_active", true).order("full_name");
      return data ?? [];
    },
  });

  const { data: loanProducts = [] } = useQuery({
    queryKey: ["loan-products-active"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await sql.from("loan_products" as any).select("*").eq("is_active", true).order("name");
      return (data ?? []) as any[];
    },
  });

  const { data: applicantInfo } = useQuery({
    queryKey: ["applicant-info", selectedCustomer],
    enabled: !!selectedCustomer,
    queryFn: async () => {
      const [{ data: cust }, { data: qualified }] = await Promise.all([
        sql.from("customers").select("credit_score, monthly_income").eq("id", selectedCustomer).maybeSingle(),
        sql.rpc("qualified_loan_amount", { _customer_id: selectedCustomer }),
      ]);
      return {
        credit_score: cust?.credit_score ?? 650,
        monthly_income: cust?.monthly_income ?? null,
        qualified: Number(qualified ?? 0),
      };
    },
  });

  const createMut = useMutation({
    mutationFn: async (fd: FormData) => {
      const d = Object.fromEntries(fd.entries()) as Record<string, string>;
      const principal = Number(d.principal);
      const loan_number = "L" + Date.now().toString().slice(-9);
      const { error } = await sql.from("loans").insert({
        loan_number,
        customer_id: d.customer_id,
        principal,
        interest_rate: Number(d.interest_rate),
        term_months: Number(d.term_months),
        method: d.method as "flat" | "reducing_balance" | "amortized",
        product_id: d.product_id || null,
        purpose: d.purpose || null,
        projected_payment_date: d.projected_payment_date || null,
        outstanding_balance: principal,
        status: "draft",
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Loan saved as draft"); qc.invalidateQueries({ queryKey: ["loans"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sql.from("loans").update({ status: "pending", submitted_for_approval_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Submitted for approval"); qc.invalidateQueries({ queryKey: ["loans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data: check } = await sql
        .from("loans")
        .select("customer:customers!loans_customer_fk(full_name, kyc_status)")
        .eq("id", id)
        .maybeSingle();
      const cust = (check as any)?.customer;
      if (cust && cust.kyc_status !== "verified")
        throw new Error(`${cust.full_name} is not KYC-verified yet — verify the client before approving.`);
      const { error } = await sql.from("loans").update({ status: "approved", approved_by: user!.id }).eq("id", id);
      if (error) throw error;
    },

    onSuccess: () => { toast.success("Loan approved"); qc.invalidateQueries({ queryKey: ["loans"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await sql.from("loans").update({ status: "rejected", rejection_reason: reason, approved_by: user!.id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Loan rejected"); qc.invalidateQueries({ queryKey: ["loans"] }); setRejectFor(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const disburse = useMutation({
    mutationFn: async (id: string) => {
      // Monthly term: due date is 30 days after the disbursement date.
      const disbursement_date = isoDate(new Date());
      const due_date = isoDate(addDays(new Date(disbursement_date + "T00:00:00"), 30));
      const { error } = await sql
        .from("loans")
        .update({ status: "disbursed", disbursement_date, due_date, next_payment_date: due_date })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Loan disbursed"); qc.invalidateQueries({ queryKey: ["loans"] }); qc.invalidateQueries({ queryKey: ["dashboard-stats"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) return null;
  const canCreate = hasRole("admin") || hasRole("super_admin") || hasRole("manager") || hasRole("loan_officer");
  const canApprove = hasRole("admin") || hasRole("super_admin") || hasRole("manager");

  const s = search.trim().toLowerCase();
  const filteredLoans = (loans as any[]).filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (!s) return true;
    return (
      String(l.loan_number ?? "").toLowerCase().includes(s) ||
      String(l.customer?.full_name ?? "").toLowerCase().includes(s) ||
      String(l.customer?.customer_number ?? "").toLowerCase().includes(s)
    );
  });
  const totalPages = Math.max(Math.ceil(filteredLoans.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const pagedLoans = filteredLoans.slice((safePage - 1) * pageSize, safePage * pageSize);



  // CSV import — loans land as drafts, matched to an existing client by customer_number or national_id.
  const importLoans = async (rows: Record<string, string>[]): Promise<ImportResult> => {
    const num = (v?: string) => Number((v ?? "").replace(/,/g, ""));
    let inserted = 0, skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      const key = (r.customer_number || r.national_id || "").trim();
      const principal = num(r.principal);
      if (!key || !(principal > 0)) { skipped++; errors.push(`Row ${line}: customer_number (or national_id) and a positive principal are required`); continue; }
      try {
        const col = r.customer_number ? "customer_number" : "national_id";
        const { data: cust } = await sql.from("customers").select("id").eq(col, key).limit(1);
        if (!cust || !cust.length) { skipped++; errors.push(`Row ${line}: no client found for ${key}`); continue; }
        const { error } = await sql.from("loans").insert({
          loan_number: (r.loan_number || "").trim() || "L" + Date.now().toString().slice(-9) + i,
          customer_id: (cust[0] as any).id,
          principal,
          interest_rate: Number(r.interest_rate) || 0.2,
          term_months: Number(r.term_months) || 1,
          method: ["flat", "reducing_balance", "daily_accrual"].includes(r.method) ? r.method : "daily_accrual",
          status: "draft",
          outstanding_balance: principal,
          purpose: r.purpose?.trim() || null,
          created_by: user!.id,
        });
        if (error) throw error;
        inserted++;
      } catch (e) {
        skipped++;
        errors.push(`Row ${line}: ${(e as Error).message}`);
      }
    }
    return { inserted, skipped, errors };
  };


  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Loans"
          description="Lifecycle: Draft → Pending → Approved → Disbursed → Active → Closed."
          actions={(
            <div className="flex gap-2">
            <ImportExport
              entity="loans"
              columns={LOAN_CSV_COLUMNS}
              exportRows={async () => {
                const { data } = await sql
                  .from("loans")
                  .select("*, customer:customers!loans_customer_fk(full_name, customer_number)")
                  .order("created_at", { ascending: false })
                  .limit(5000);
                return ((data ?? []) as any[]).map((l) => ({
                  ...l,
                  customer_name: l.customer?.full_name ?? "",
                  customer_number: l.customer?.customer_number ?? "",
                }));
              }}
              onImport={importLoans}
              onImported={() => qc.invalidateQueries({ queryKey: ["loans"] })}
            />
            {canCreate && (
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelectedCustomer(""); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New loan</Button></DialogTrigger>

              <DialogContent className="max-w-xl">
                <DialogHeader><DialogTitle>Loan application (saved as draft)</DialogTitle></DialogHeader>
                <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(new FormData(e.currentTarget)); }}>
                  <div className="col-span-2 space-y-2">
                    <Label>Customer</Label>
                    <Select name="customer_id" required value={selectedCustomer} onValueChange={setSelectedCustomer}>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.full_name} ({c.customer_number}) — score {c.credit_score ?? 650}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedCustomer && applicantInfo && (
                    <div className="col-span-2 grid grid-cols-3 gap-2 text-xs rounded-lg border border-border bg-muted/30 p-3">
                      <div>
                        <div className="text-muted-foreground">Credit score</div>
                        <div className="font-mono font-semibold text-sm">
                          {applicantInfo.credit_score}
                          <span className={"ml-2 text-[10px] px-1.5 py-0.5 rounded " +
                            (applicantInfo.credit_score >= 720 ? "bg-success/15 text-success"
                              : applicantInfo.credit_score >= 600 ? "bg-primary-soft text-primary"
                              : applicantInfo.credit_score >= 500 ? "bg-warning/15 text-warning-foreground"
                              : "bg-destructive/15 text-destructive")}>
                            {applicantInfo.credit_score >= 720 ? "Excellent" : applicantInfo.credit_score >= 600 ? "Good" : applicantInfo.credit_score >= 500 ? "Fair" : "Poor"}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Monthly income</div>
                        <div className="font-mono font-semibold text-sm">{applicantInfo.monthly_income ? fmt(Number(applicantInfo.monthly_income)) : "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Qualifies for up to</div>
                        <div className="font-mono font-semibold text-sm text-primary">{fmt(applicantInfo.qualified)}</div>
                      </div>
                    </div>
                  )}
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
                  <div className="col-span-2 space-y-2">
                    <Label>Loan product</Label>
                    <Select name="product_id" value={selectedProduct} onValueChange={setSelectedProduct}>
                      <SelectTrigger><SelectValue placeholder="Default rules (no product)" /></SelectTrigger>
                      <SelectContent>
                        {loanProducts.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const r = rulesFromProduct(loanProducts.find((p: any) => p.id === selectedProduct));
                      return (
                        <p className="text-xs text-muted-foreground">
                          0–{r.tier1_days}d: {(r.min_principal_pct * 100).toFixed(0)}% minimum · {r.tier1_days + 1}–{r.tier2_days}d: MAX(minimum, {r.daily_per_1000}/1,000 per day) · {r.tier2_days + 1}d+: {(r.monthly_pct * 100).toFixed(0)}% per {r.monthly_days}-day month
                        </p>
                      );
                    })()}
                  </div>
                  <div className="space-y-2"><Label>Projected payment date</Label><Input name="projected_payment_date" type="date" /></div>
                  <div className="space-y-2"><Label>&nbsp;</Label><div className="text-xs text-muted-foreground">Officer's expected repayment date.</div></div>
                  <div className="col-span-2 space-y-2"><Label>Purpose</Label><Textarea name="purpose" rows={2} /></div>
                  <DialogFooter className="col-span-2">
                    <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? "Saving…" : "Save draft"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            )}
            </div>
          )}

        />

        <LoanStats loans={loans} />

        <div className="bg-card border border-border rounded-xl mt-4">
          <div className="p-4 border-b border-border flex flex-wrap gap-3 items-center">
            <div className="relative max-w-sm flex-1 min-w-[220px]">
              <SearchIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search loan #, customer or customer #…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {["all", "draft", "pending", "approved", "disbursed", "active", "in_arrears", "closed", "rejected"].map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(search || statusFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear</Button>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Loan #</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-right px-4 py-3 font-medium">Principal</th>
                <th className="text-right px-4 py-3 font-medium">Total payable</th>
                <th className="text-left px-4 py-3 font-medium">Disbursed</th>
                <th className="text-left px-4 py-3 font-medium">Due</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedLoans.length === 0 && <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No loans match your filters.</td></tr>}
              {pagedLoans.map((l) => {
                const isCreator = l.created_by === user.id;
                const principal = Number(l.principal);
                const outstanding = Number(l.outstanding_balance);
                const isOpen = ["active", "in_arrears", "disbursed"].includes(l.status);
                const days = isOpen ? loanDaysElapsed(l.disbursement_date) : 0;
                const { total } = isOpen ? computeTotalDue(principal, days, l.due_date) : { total: principal };
                // If loan already partially paid, remaining to settle = total - (principal - outstanding)
                const paid = Math.max(principal - outstanding, 0);
                const remaining = isOpen ? Math.max(total - paid, 0) : outstanding;
                const isOverdue = l.status === "in_arrears" || (l.due_date && new Date(l.due_date) < new Date() && outstanding > 0 && l.status !== "closed");
                const disbursedOn = l.disbursement_date ?? (l.disbursed_at ? String(l.disbursed_at).slice(0, 10) : null);
                return (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setDetailLoan(l)}>
                    <td className="px-4 py-3 font-mono text-xs">{l.loan_number}</td>
                    <td className="px-4 py-3">{l.customer?.full_name ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(principal)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <div className="font-semibold">{fmt(remaining)}</div>
                      {isOpen && <div className="text-[10px] text-muted-foreground">of {fmt(total)} · day {days}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{fmtDate(disbursedOn)}</td>
                    <td className={"px-4 py-3 text-xs " + (isOverdue ? "text-destructive font-medium" : "")}>{fmtDate(l.due_date)}{isOverdue && " ⚠"}</td>

                    <td className="px-4 py-3"><LoanStatusBadge status={l.status} /></td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1 flex-wrap justify-end">
                        {canCreate && l.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate(l.id)}>Submit</Button>
                        )}
                        {canApprove && l.status === "pending" && (!isCreator || hasRole("super_admin")) && (
                          <>
                            {l.customer?.kyc_status === "verified" ? (
                              <Button size="sm" variant="outline" onClick={() => approve.mutate(l.id)}>
                                Approve{isCreator && hasRole("super_admin") ? " (bypass)" : ""}
                              </Button>
                            ) : (
                              <span className="text-xs text-warning-foreground italic" title="Client KYC must be verified before approval">
                                client not verified
                              </span>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setRejectFor(l.id)}>Reject</Button>
                          </>
                        )}

                        {canApprove && l.status === "pending" && isCreator && !hasRole("super_admin") && (
                          <span className="text-xs text-muted-foreground italic">awaiting checker</span>
                        )}
                        {canApprove && l.status === "approved" && (
                          <Button size="sm" variant="default" onClick={() => disburse.mutate(l.id)}>Disburse</Button>
                        )}
                        {(l.status === "active" || l.status === "in_arrears" || l.status === "disbursed") && Number(l.outstanding_balance) > 0 && (
                          <RepaymentDialog loan={{
                            id: l.id,
                            loan_number: l.loan_number,
                            outstanding: Number(l.outstanding_balance),
                            principal: Number(l.principal),
                            customer_id: l.customer_id,
                            disbursement_date: l.disbursement_date,
                            due_date: l.due_date,
                          }} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <Pagination page={safePage} pageSize={pageSize} total={filteredLoans.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>

      </div>

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject loan</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); const reason = (new FormData(e.currentTarget).get("reason") as string) || "No reason provided"; if (rejectFor) reject.mutate({ id: rejectFor, reason }); }} className="space-y-4">
            <div className="space-y-2"><Label>Rejection reason</Label><Textarea name="reason" rows={3} required /></div>
            <DialogFooter><Button type="submit" variant="destructive">Reject</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LoanDetailDialog loan={detailLoan} open={!!detailLoan} onOpenChange={(o) => !o && setDetailLoan(null)} />
    </AppShell>
  );
}

function LoanStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    pending: "bg-warning/15 text-warning-foreground",
    approved: "bg-primary-soft text-primary",
    disbursed: "bg-success/15 text-success",
    active: "bg-success/15 text-success",
    in_arrears: "bg-destructive/15 text-destructive",
    rejected: "bg-destructive/10 text-destructive",
    closed: "bg-muted text-muted-foreground",
  };
  return <span className={"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize " + (map[status] ?? "bg-muted")}>{status.replace("_", " ")}</span>;
}

const fmt = _fmtKES;

function LoanStats({ loans }: { loans: any[] }) {
  const active = loans.filter((l) => ["active", "in_arrears", "disbursed"].includes(l.status));
  const overdue = loans.filter((l) => l.status === "in_arrears" || (l.due_date && new Date(l.due_date) < new Date() && Number(l.outstanding_balance) > 0 && l.status !== "closed"));
  const pending = loans.filter((l) => l.status === "pending");
  const portfolio = active.reduce((s, l) => s + Number(l.outstanding_balance), 0);
  const overdueAmt = overdue.reduce((s, l) => s + Number(l.outstanding_balance), 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <Stat label="Active loans" value={String(active.length)} sub={fmt(portfolio) + " outstanding"} />
      <Stat label="Pending approval" value={String(pending.length)} />
      <Stat label="Overdue" value={String(overdue.length)} sub={fmt(overdueAmt)} tone={overdue.length > 0 ? "danger" : undefined} />
      <Stat label="Total loans" value={String(loans.length)} />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className={"rounded-xl border border-border bg-card p-3 " + (tone === "danger" ? "border-destructive/40" : "")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-xl font-semibold font-mono " + (tone === "danger" ? "text-destructive" : "")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground font-mono">{sub}</div>}
    </div>
  );
}
