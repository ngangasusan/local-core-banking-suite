import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { sql } from "@/lib/sql-client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtKES } from "@/lib/format";
import { toast } from "sonner";
import { Phone, MessageSquare, MapPin, FileText, AlertTriangle, CalendarClock, ShieldAlert, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/collections")({
  component: CollectionsPage,
});

type WorklistRow = {
  loan_id: string;
  loan_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  outstanding_balance: number;
  due_date: string | null;
  status: string;
  dpd: number;
  bucket: string;
  last_contact_at: string | null;
  open_ptp_date: string | null;
  open_ptp_amount: number | null;
};

const BUCKETS: { key: string; label: string }[] = [
  { key: "all", label: "All overdue" },
  { key: "par_1_30", label: "1–30 dpd" },
  { key: "par_31_60", label: "31–60 dpd" },
  { key: "par_61_90", label: "61–90 dpd" },
  { key: "par_90_plus", label: "90+ dpd" },
];

function CollectionsPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const [bucket, setBucket] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openLoan, setOpenLoan] = useState<WorklistRow | null>(null);

  const qc = useQueryClient();

  const { data: worklist = [], isLoading } = useQuery({
    queryKey: ["collections-worklist"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sql
        .from("collections_worklist")
        .select("*")
        .order("dpd", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as WorklistRow[];
    },
  });

  const filtered = useMemo(() => {
    return worklist.filter((r) => {
      if (bucket === "all" ? r.dpd <= 0 : r.bucket !== bucket) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !r.loan_number.toLowerCase().includes(s) &&
          !r.customer_name.toLowerCase().includes(s) &&
          !(r.customer_phone ?? "").toLowerCase().includes(s)
        ) return false;
      }
      return true;
    });
  }, [worklist, bucket, search]);

  const totals = useMemo(() => {
    const t = { count: filtered.length, exposure: 0, withPtp: 0 };
    for (const r of filtered) {
      t.exposure += Number(r.outstanding_balance);
      if (r.open_ptp_date) t.withPtp += 1;
    }
    return t;
  }, [filtered]);

  const sweepBroken = useMutation({
    mutationFn: async () => {
      const { error } = await sql.rpc("sweep_broken_promises");
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Promises swept"); qc.invalidateQueries({ queryKey: ["collections-worklist"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSweep = hasRole("manager") || hasRole("admin") || hasRole("super_admin");

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Collections & Recovery"
          description="Chase overdue customers, log contact attempts, capture promises-to-pay, and escalate to restructure or write-off."
          actions={
            canSweep ? (
              <Button variant="outline" size="sm" onClick={() => sweepBroken.mutate()} disabled={sweepBroken.isPending}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Sweep promises
              </Button>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <Stat label="Loans in queue" value={String(totals.count)} />
          <Stat label="Exposure at risk" value={fmtKES(totals.exposure)} highlight />
          <Stat label="With open promise" value={String(totals.withPtp)} />
        </div>

        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {BUCKETS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBucket(b.key)}
                  className={
                    "text-xs px-3 py-1.5 rounded-md border transition-colors " +
                    (bucket === b.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground")
                  }
                >
                  {b.label}
                </button>
              ))}
            </div>
            <Input
              placeholder="Search loan #, customer, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:ml-auto sm:max-w-xs"
            />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Loan #</th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Phone</th>
                  <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                  <th className="text-left px-3 py-2 font-medium">Due</th>
                  <th className="text-left px-3 py-2 font-medium">DPD</th>
                  <th className="text-left px-3 py-2 font-medium">Promise</th>
                  <th className="text-left px-3 py-2 font-medium">Last contact</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</td></tr>}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Nothing in this bucket. ✅</td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.loan_id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.loan_number}</td>
                    <td className="px-3 py-2">{r.customer_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.customer_phone ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtKES(r.outstanding_balance)}</td>
                    <td className="px-3 py-2 text-xs">{r.due_date ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={r.dpd >= 90 ? "destructive" : r.dpd >= 30 ? "secondary" : "outline"}>
                        {r.dpd}d
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.open_ptp_date ? (
                        <span className="text-primary">{fmtKES(Number(r.open_ptp_amount))} by {r.open_ptp_date}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.last_contact_at ? new Date(r.last_contact_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenLoan(r)}>Manage</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <LoanCollectionDialog row={openLoan} onClose={() => setOpenLoan(null)} />
      </div>
    </AppShell>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={"rounded-lg border border-border p-4 " + (highlight ? "bg-primary-soft" : "bg-card")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"font-mono text-lg mt-0.5 " + (highlight ? "text-primary font-semibold" : "")}>{value}</div>
    </div>
  );
}

function LoanCollectionDialog({ row, onClose }: { row: WorklistRow | null; onClose: () => void }) {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const isManager = hasRole("manager") || hasRole("admin") || hasRole("super_admin");
  const isAdmin = hasRole("admin") || hasRole("super_admin");
  const isOfficer = isManager || hasRole("loan_officer");

  // Action form
  const [channel, setChannel] = useState<string>("call");
  const [outcome, setOutcome] = useState<string>("reached");
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");

  // PTP form
  const [ptpAmount, setPtpAmount] = useState("");
  const [ptpDate, setPtpDate] = useState("");

  // Restructure form
  const [rsReason, setRsReason] = useState("");
  const [rsDate, setRsDate] = useState("");

  // Write-off form
  const [woAmount, setWoAmount] = useState("");
  const [woReason, setWoReason] = useState("");

  const { data: actions = [] } = useQuery({
    queryKey: ["collection-actions", row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data } = await sql
        .from("collection_actions").select("*")
        .eq("loan_id", row!.loan_id).order("performed_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });

  const { data: promises = [] } = useQuery({
    queryKey: ["promises", row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data } = await sql
        .from("promises_to_pay").select("*")
        .eq("loan_id", row!.loan_id).order("created_at", { ascending: false }).limit(50);
      return data ?? [];
    },
  });

  const { data: restructures = [] } = useQuery({
    queryKey: ["restructures", row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data } = await sql
        .from("loan_restructures").select("*")
        .eq("loan_id", row!.loan_id).order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const { data: writeoffs = [] } = useQuery({
    queryKey: ["writeoffs", row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data } = await sql
        .from("loan_writeoffs").select("*")
        .eq("loan_id", row!.loan_id).order("created_at", { ascending: false }).limit(20);
      return data ?? [];
    },
  });

  const { data: guarantors = [] } = useQuery({
    queryKey: ["loan-guarantors", row?.customer_id, row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data: g } = await sql
        .from("guarantors").select("id, full_name, phone, relationship")
        .eq("customer_id", row!.customer_id);
      const { data: f } = await sql
        .from("guarantor_followups").select("*").eq("loan_id", row!.loan_id);
      return (g ?? []).map((x) => ({ ...x, followup: (f ?? []).find((y) => y.guarantor_id === x.id) ?? null }));
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["loan-history", row?.loan_id],
    enabled: !!row,
    queryFn: async () => {
      const { data } = await sql
        .from("loan_repayments")
        .select("id, amount, reference, paid_at, created_at, principal_portion, interest_portion, penalty_portion, fee_portion")
        .eq("loan_id", row!.loan_id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });


  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["collections-worklist"] });
    qc.invalidateQueries({ queryKey: ["collection-actions", row?.loan_id] });
    qc.invalidateQueries({ queryKey: ["promises", row?.loan_id] });
    qc.invalidateQueries({ queryKey: ["restructures", row?.loan_id] });
    qc.invalidateQueries({ queryKey: ["writeoffs", row?.loan_id] });
    qc.invalidateQueries({ queryKey: ["loan-guarantors", row?.customer_id, row?.loan_id] });
  };

  const logAction = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await sql.auth.getUser();
      const { error } = await sql.from("collection_actions").insert({
        loan_id: row!.loan_id, customer_id: row!.customer_id,
        channel: channel as any, outcome: outcome as any,
        notes: notes || null, next_action_at: nextAction || null,
        performed_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Logged"); setNotes(""); setNextAction(""); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordPtp = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await sql.auth.getUser();
      const amt = Number(ptpAmount);
      if (!amt || !ptpDate) throw new Error("Amount and date required");
      const { error } = await sql.from("promises_to_pay").insert({
        loan_id: row!.loan_id, customer_id: row!.customer_id,
        promised_amount: amt, promised_date: ptpDate,
        recorded_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Promise recorded"); setPtpAmount(""); setPtpDate(""); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelPtp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sql.from("promises_to_pay")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Cancelled"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestRestructure = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await sql.auth.getUser();
      if (!rsReason || !rsDate) throw new Error("Reason and new due date required");
      const { error } = await sql.from("loan_restructures").insert({
        loan_id: row!.loan_id, reason: rsReason, new_due_date: rsDate, requested_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Restructure requested"); setRsReason(""); setRsDate(""); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveRestruct = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await sql.rpc("approve_loan_restructure", { _id: id, _approve: approve });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestWriteoff = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await sql.auth.getUser();
      const amt = Number(woAmount);
      if (!amt || !woReason) throw new Error("Amount and reason required");
      const { error } = await sql.from("loan_writeoffs").insert({
        loan_id: row!.loan_id, amount: amt, reason: woReason, requested_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Write-off requested"); setWoAmount(""); setWoReason(""); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveWriteoff = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await sql.rpc("approve_loan_writeoff", { _id: id, _approve: approve });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Updated"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const upsertGuarantorFollowup = useMutation({
    mutationFn: async ({ guarantor_id, status, notes }: { guarantor_id: string; status: string; notes?: string }) => {
      const { data: existing } = await sql
        .from("guarantor_followups").select("id")
        .eq("loan_id", row!.loan_id).eq("guarantor_id", guarantor_id).maybeSingle();
      const payload: any = { status, notes: notes || null, contacted_at: new Date().toISOString() };
      if (existing) {
        const { error } = await sql.from("guarantor_followups").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await sql.from("guarantor_followups").insert({
          loan_id: row!.loan_id, guarantor_id, ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Guarantor updated"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!row) return null;

  const channelIcon = (c: string) => c === "call" ? <Phone className="h-3 w-3" /> : c === "sms" ? <MessageSquare className="h-3 w-3" /> : c === "visit" || c === "field" ? <MapPin className="h-3 w-3" /> : <FileText className="h-3 w-3" />;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm">{row.loan_number}</span>
            <span>·</span>
            <span>{row.customer_name}</span>
            <Badge variant={row.dpd >= 90 ? "destructive" : "secondary"}>{row.dpd}d overdue</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-4">
          <Stat label="Outstanding" value={fmtKES(row.outstanding_balance)} highlight />
          <Stat label="Due date" value={row.due_date ?? "—"} />
          <Stat label="Phone" value={row.customer_phone ?? "—"} />
          <Stat label="Bucket" value={row.bucket.replace("par_", "").replace("_", "–") + " dpd"} />
        </div>

        <Tabs defaultValue="contact">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="contact">Contact</TabsTrigger>
            <TabsTrigger value="ptp">Promises</TabsTrigger>
            <TabsTrigger value="guarantors">Guarantors</TabsTrigger>
            <TabsTrigger value="restructure">Restructure</TabsTrigger>
            <TabsTrigger value="writeoff">Write-off</TabsTrigger>
          </TabsList>

          <TabsContent value="contact" className="space-y-3 mt-4">
            <div className="border border-border rounded-lg p-3 bg-muted/30 grid grid-cols-2 gap-2">
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["call","sms","email","visit","letter","field"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["reached","no_answer","wrong_number","promise","refused","partial_payment","dispute","other"].map((c) => <SelectItem key={c} value={c}>{c.replace("_"," ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next action date" />
              <Button onClick={() => logAction.mutate()} disabled={logAction.isPending}>Log contact</Button>
              <Textarea className="col-span-2" placeholder="Notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Channel</th><th className="text-left px-3 py-2">Outcome</th><th className="text-left px-3 py-2">Notes</th><th className="text-left px-3 py-2">Next</th></tr>
                </thead>
                <tbody>
                  {actions.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No contact attempts yet.</td></tr>}
                  {actions.map((a: any) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs">{new Date(a.performed_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs"><span className="inline-flex items-center gap-1">{channelIcon(a.channel)}{a.channel}</span></td>
                      <td className="px-3 py-2 text-xs">{a.outcome.replace("_"," ")}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.notes ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{a.next_action_at ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="ptp" className="space-y-3 mt-4">
            <div className="border border-border rounded-lg p-3 bg-muted/30 grid grid-cols-3 gap-2">
              <Input type="number" placeholder="Amount" value={ptpAmount} onChange={(e) => setPtpAmount(e.target.value)} />
              <Input type="date" value={ptpDate} onChange={(e) => setPtpDate(e.target.value)} />
              <Button onClick={() => recordPtp.mutate()} disabled={recordPtp.isPending}>Record promise</Button>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">Promised</th><th className="text-right px-3 py-2">Amount</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Collected since</th><th></th></tr>
                </thead>
                <tbody>
                  {promises.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No promises.</td></tr>}
                  {promises.map((p: any) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs">{p.promised_date}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtKES(Number(p.promised_amount))}</td>
                      <td className="px-3 py-2">
                        <Badge variant={p.status === "kept" ? "default" : p.status === "broken" ? "destructive" : p.status === "cancelled" ? "outline" : "secondary"}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmtKES(Number(p.resolved_amount ?? 0))}</td>
                      <td className="px-3 py-2 text-right">
                        {p.status === "open" && (
                          <Button variant="ghost" size="sm" onClick={() => cancelPtp.mutate(p.id)}>Cancel</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="guarantors" className="mt-4">
            {guarantors.length === 0 ? (
              <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
                No guarantors recorded for this customer.
              </div>
            ) : (
              <div className="space-y-2">
                {guarantors.map((g) => (
                  <div key={g.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{g.full_name}</div>
                        <div className="text-xs text-muted-foreground">{g.relationship ?? "—"} · {g.phone}</div>
                      </div>
                      <Badge variant={g.followup?.status === "escalated" ? "destructive" : g.followup?.status === "committed" ? "default" : "secondary"}>
                        {g.followup?.status ?? "pending"}
                      </Badge>
                    </div>
                    {isOfficer && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(["contacted","committed","escalated","closed"] as const).map((s) => (
                          <Button key={s} size="sm" variant="outline"
                            onClick={() => upsertGuarantorFollowup.mutate({ guarantor_id: g.id, status: s })}>
                            Mark {s}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="restructure" className="space-y-3 mt-4">
            <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Reschedule the loan. Approval requires manager+ (4-eyes).</div>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={rsDate} onChange={(e) => setRsDate(e.target.value)} placeholder="New due date" />
                <Button onClick={() => requestRestructure.mutate()} disabled={requestRestructure.isPending}>Request restructure</Button>
              </div>
              <Textarea placeholder="Reason for restructure…" value={rsReason} onChange={(e) => setRsReason(e.target.value)} />
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">Requested</th><th className="text-left px-3 py-2">New due</th><th className="text-left px-3 py-2">Reason</th><th className="text-left px-3 py-2">Status</th><th></th></tr>
                </thead>
                <tbody>
                  {restructures.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No restructures.</td></tr>}
                  {restructures.map((r: any) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs">{new Date(r.requested_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs">{r.new_due_date}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.reason}</td>
                      <td className="px-3 py-2"><Badge>{r.status}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        {isManager && r.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" onClick={() => approveRestruct.mutate({ id: r.id, approve: true })}>Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => approveRestruct.mutate({ id: r.id, approve: false })}>Reject</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="writeoff" className="space-y-3 mt-4">
            <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" />Write-off recognises the loss. Posts to Bad Debt Expense (5100). Admin + MFA required to approve.</div>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Amount" value={woAmount} onChange={(e) => setWoAmount(e.target.value)} />
                <Button onClick={() => requestWriteoff.mutate()} disabled={requestWriteoff.isPending} variant="destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Request write-off
                </Button>
              </div>
              <Textarea placeholder="Reason for write-off…" value={woReason} onChange={(e) => setWoReason(e.target.value)} />
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">Requested</th><th className="text-right px-3 py-2">Amount</th><th className="text-left px-3 py-2">Reason</th><th className="text-left px-3 py-2">Status</th><th></th></tr>
                </thead>
                <tbody>
                  {writeoffs.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No write-offs.</td></tr>}
                  {writeoffs.map((w: any) => (
                    <tr key={w.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs">{new Date(w.requested_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtKES(Number(w.amount))}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{w.reason}</td>
                      <td className="px-3 py-2"><Badge variant={w.status === "applied" ? "default" : w.status === "rejected" ? "destructive" : "secondary"}>{w.status}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        {isAdmin && w.status === "pending" && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" onClick={() => approveWriteoff.mutate({ id: w.id, approve: true })}>Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => approveWriteoff.mutate({ id: w.id, approve: false })}>Reject</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
