import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Eye, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type CustomerLite = {
  id: string;
  full_name: string;
  customer_number: string;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  monthly_income: number | string | null;
  credit_score: number | null;
  kyc_status: string;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
}

export function CustomerDetailDialog({ customer, open, onOpenChange }: { customer: CustomerLite | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts = [] } = useQuery({
    queryKey: ["customer-accounts", customer?.id],
    enabled: !!customer?.id && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("id, account_number, account_type, balance, status, currency")
        .eq("customer_id", customer!.id)
        .order("created_at");
      return data ?? [];
    },
  });

  const { data: loans = [] } = useQuery({
    queryKey: ["customer-loans", customer?.id],
    enabled: !!customer?.id && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("loans")
        .select("id, loan_number, principal, outstanding_balance, status, disbursement_date, due_date")
        .eq("customer_id", customer!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: qualified } = useQuery({
    queryKey: ["customer-qualified", customer?.id],
    enabled: !!customer?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("qualified_loan_amount", { _customer_id: customer!.id });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  const { data: idDocs = [] } = useQuery({
    queryKey: ["customer-id-docs", customer?.id],
    enabled: !!customer?.id && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("kyc_documents")
        .select("id, doc_type, storage_path, uploaded_at")
        .eq("customer_id", customer!.id)
        .eq("is_id_document", true)
        .order("uploaded_at", { ascending: false });
      return data ?? [];
    },
  });

  const [idUrls, setIdUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open || idDocs.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const d of idDocs) {
        const { data } = await supabase.storage.from("kyc-documents").createSignedUrl(d.storage_path, 600);
        if (data?.signedUrl) out[d.id] = data.signedUrl;
      }
      if (!cancelled) setIdUrls(out);
    })();
    return () => { cancelled = true; };
  }, [open, idDocs]);

  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const canVerify = hasRole("manager") || hasRole("admin") || hasRole("super_admin");
  const canReveal = hasRole("admin") || hasRole("super_admin") || hasRole("auditor");
  const [revealed, setRevealed] = useState<{ national_id: string | null; phone: string | null; email: string | null; dob: string | null } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const reveal = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("decrypt_customer_pii", { _customer_id: customer!.id });
      if (error) throw error;
      const row = (data as any[])?.[0];
      return row ?? null;
    },
    onSuccess: (row) => { setRevealed(row); toast.success("PII revealed (audited)"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyKyc = useMutation({
    mutationFn: async ({ approve, reason }: { approve: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("verify_customer_kyc", { _customer_id: customer!.id, _approve: approve, _reason: reason ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("KYC updated");
      qc.invalidateQueries({ queryKey: ["customers"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!customer) return null;
  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);
  const activeLoans = loans.filter((l) => ["active", "in_arrears", "disbursed"].includes(l.status));
  const totalOutstanding = activeLoans.reduce((s, l) => s + Number(l.outstanding_balance), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {customer.full_name} <span className="text-muted-foreground font-mono text-sm">({customer.customer_number})</span>
            <Badge variant={customer.kyc_status === "verified" ? "default" : customer.kyc_status === "rejected" ? "destructive" : "secondary"} className="capitalize">
              KYC: {customer.kyc_status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Phone" value={revealed?.phone ?? customer.phone ?? "—"} />
          <Stat label="National ID" value={revealed?.national_id ?? customer.national_id ?? "—"} />
          <Stat label="KYC" value={customer.kyc_status} />
          <Stat label="Credit score" value={String(customer.credit_score ?? 650)} />
          <Stat label="Monthly income" value={customer.monthly_income ? fmt(Number(customer.monthly_income)) : "—"} />
          <Stat label="Total balance" value={fmt(totalBalance)} />
          <Stat label="Outstanding loans" value={fmt(totalOutstanding)} />
          <Stat label="Loan qualification" value={qualified != null ? fmt(qualified) : "…"} highlight />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Qualification factors in income, account balance, credit score and current outstanding loans.
        </p>

        {canReveal && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
              <Eye className="h-3.5 w-3.5 mr-1" />{revealed ? "Re-fetch PII" : "Reveal encrypted PII"}
            </Button>
            <span className="text-xs text-muted-foreground">Decrypts from PII vault. Action is audited.</span>
          </div>
        )}

        {canVerify && customer.kyc_status !== "verified" && (
          <div className="mt-4 border border-border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" />KYC verification (4-eyes)</div>
            <p className="text-xs text-muted-foreground">You cannot verify a customer you onboarded. Approval requires an ID document on file.</p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => verifyKyc.mutate({ approve: true })} disabled={verifyKyc.isPending}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => verifyKyc.mutate({ approve: false, reason: rejectReason || "Rejected" })} disabled={verifyKyc.isPending}>
                <ShieldX className="h-3.5 w-3.5 mr-1" />Reject
              </Button>
              <Textarea placeholder="Rejection reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="h-9 min-h-9" />
            </div>
          </div>
        )}

        <section className="mt-5">
          <h3 className="text-sm font-medium mb-2">Customer ID document{idDocs.length > 1 ? "s" : ""} ({idDocs.length})</h3>
          {idDocs.length === 0 ? (
            <div className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
              No ID document on file.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {idDocs.map((d) => {
                const url = idUrls[d.id];
                const isPdf = d.storage_path.toLowerCase().endsWith(".pdf");
                return (
                  <a
                    key={d.id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-border rounded-lg overflow-hidden bg-muted/30 hover:border-primary transition-colors"
                  >
                    {url && !isPdf ? (
                      <img src={url} alt={`${customer.full_name} — ${d.doc_type}`} className="w-full h-40 object-cover" />
                    ) : (
                      <div className="w-full h-40 flex items-center justify-center bg-muted">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-2 text-xs">
                      <div className="font-medium truncate">{d.doc_type}</div>
                      <div className="text-muted-foreground">{new Date(d.uploaded_at).toLocaleDateString()}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>
        <section className="mt-5">
          <h3 className="text-sm font-medium mb-2">Accounts ({accounts.length})</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Account #</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">No accounts.</td></tr>}
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{a.account_number}</td>
                    <td className="px-3 py-2 capitalize">{a.account_type}</td>
                    <td className="px-3 py-2 capitalize">{a.status}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(a.balance))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-medium mb-2">Loans ({loans.length})</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Loan #</th>
                  <th className="text-right px-3 py-2 font-medium">Principal</th>
                  <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No loans.</td></tr>}
                {loans.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{l.loan_number}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(l.principal))}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(Number(l.outstanding_balance))}</td>
                    <td className="px-3 py-2 capitalize">{l.status.replace("_", " ")}</td>
                    <td className="px-3 py-2 text-xs">{l.due_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={"rounded-lg border border-border p-3 " + (highlight ? "bg-primary-soft" : "bg-card")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"font-mono text-sm " + (highlight ? "text-primary font-semibold" : "")}>{value}</div>
    </div>
  );
}
