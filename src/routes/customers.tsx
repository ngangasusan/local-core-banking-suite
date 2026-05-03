import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ShieldCheck, ShieldAlert, ShieldQuestion, Pencil, MoreHorizontal, Eye, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { z } from "zod";
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
import { KycUpload } from "@/components/KycUpload";
import { CustomerDetailDialog } from "@/components/CustomerDetailDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — CoreBank" },
      { name: "description", content: "Manage individual, SME and corporate customer profiles with KYC." },
    ],
  }),
  component: CustomersPage,
});

const customerSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  customer_type: z.enum(["individual", "sme", "corporate"]),
  national_id: z.string().trim().min(3, "National ID / Reg # is required").max(40),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  occupation: z.string().trim().max(80).optional().or(z.literal("")),
  monthly_income: z.string().optional(),
  kyc_notes: z.string().trim().max(500).optional().or(z.literal("")),
  // Guarantor (optional, but if any field filled, name+id+phone required)
  g_full_name: z.string().trim().max(120).optional().or(z.literal("")),
  g_national_id: z.string().trim().max(40).optional().or(z.literal("")),
  g_phone: z.string().trim().max(40).optional().or(z.literal("")),
  g_email: z.string().trim().max(150).optional().or(z.literal("")),
  g_relationship: z.string().trim().max(60).optional().or(z.literal("")),
  g_address: z.string().trim().max(300).optional().or(z.literal("")),
  g_occupation: z.string().trim().max(80).optional().or(z.literal("")),
  g_monthly_income: z.string().optional(),
});

function CustomersPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<any | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", search],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(100);
      if (search) q = q.or(`full_name.ilike.%${search}%,customer_number.ilike.%${search}%,phone.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const createMut = useMutation({
    mutationFn: async (form: FormData) => {
      const raw = Object.fromEntries(form.entries()) as Record<string, string>;
      const parsed = customerSchema.parse(raw);
      const idFile = form.get("id_document") as File | null;
      if (!idFile || idFile.size === 0) throw new Error("ID document upload is required");

      // Pre-check duplicates for friendly messaging (national_id and phone are unique)
      const orParts = [`national_id.eq.${parsed.national_id}`];
      if (parsed.phone) orParts.push(`phone.eq.${parsed.phone}`);
      const { data: existing } = await supabase
        .from("customers")
        .select("id, full_name, customer_number, national_id, phone")
        .or(orParts.join(","))
        .limit(1);
      if (existing && existing.length > 0) {
        const e = existing[0];
        const which = e.national_id === parsed.national_id ? `National ID ${parsed.national_id}` : `phone ${parsed.phone}`;
        throw new Error(`User exists: ${which} is already registered to ${e.full_name} (${e.customer_number}).`);
      }

      const customer_number = "C" + Date.now().toString().slice(-9);
      const { data: inserted, error } = await supabase.from("customers").insert({
        customer_number,
        full_name: parsed.full_name,
        customer_type: parsed.customer_type,
        national_id: parsed.national_id,
        email: parsed.email || null,
        phone: parsed.phone || null,
        address: parsed.address || null,
        city: parsed.city || null,
        occupation: parsed.occupation || null,
        monthly_income: parsed.monthly_income ? Number(parsed.monthly_income) : null,
        kyc_notes: parsed.kyc_notes || null,
        created_by: user!.id,
      }).select("id").single();
      if (error) {
        if (error.code === "23505") throw new Error("User exists: this National ID or phone number is already registered.");
        throw error;
      }

      // Upload ID document
      const path = `${inserted.id}/${Date.now()}_${idFile.name}`;
      const { error: upErr } = await supabase.storage.from("kyc-documents").upload(path, idFile);
      if (upErr) throw upErr;
      await supabase.from("kyc_documents").insert({
        customer_id: inserted.id,
        doc_type: "National ID",
        storage_path: path,
        is_id_document: true,
        uploaded_by: user!.id,
      });
    },
    onSuccess: () => {
      toast.success("Customer created");
      qc.invalidateQueries({ queryKey: ["customers"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateKyc = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "verified" | "rejected" | "pending" }) => {
      const { error } = await supabase.from("customers").update({ kyc_status: status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("KYC updated");
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCustomer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Customer deleted");
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canDelete = hasRole("admin") || hasRole("super_admin");

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Customers"
          description="Individuals, SMEs and corporate clients."
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> New customer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create customer</DialogTitle>
                </DialogHeader>
                <form
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createMut.mutate(new FormData(e.currentTarget));
                  }}
                >
                  <Field label="Full name" name="full_name" required />
                  <div className="space-y-2">
                    <Label>Customer type</Label>
                    <Select name="customer_type" defaultValue="individual">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">Individual</SelectItem>
                        <SelectItem value="sme">SME</SelectItem>
                        <SelectItem value="corporate">Corporate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Field label="National ID / Reg #" name="national_id" required />
                  <Field label="Email" name="email" type="email" />
                  <Field label="Phone" name="phone" />
                  <Field label="City" name="city" />
                  <Field label="Occupation" name="occupation" />
                  <Field label="Monthly income (KES)" name="monthly_income" type="number" />
                  <div className="sm:col-span-2 space-y-2">
                    <Label htmlFor="id_document">ID document upload *</Label>
                    <Input id="id_document" name="id_document" type="file" accept="image/*,application/pdf" required />
                    <p className="text-xs text-muted-foreground">Upload National ID, Passport, or business registration. Required for KYC.</p>
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <Label>Address</Label>
                    <Textarea name="address" rows={2} />
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <Label>KYC notes</Label>
                    <Textarea name="kyc_notes" rows={2} />
                  </div>
                  <DialogFooter className="sm:col-span-2">
                    <Button type="submit" disabled={createMut.isPending}>
                      {createMut.isPending ? "Saving…" : "Create customer"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="bg-card border border-border rounded-xl">
          <div className="p-4 border-b border-border">
            <div className="relative max-w-sm">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, number or phone…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Customer #</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">National ID</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">KYC</th>
                  <th className="text-left px-4 py-3 font-medium">Credit Score</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No customers yet. Create your first one.</td></tr>
                )}
                {customers.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setDetailCustomer(c)}>
                    <td className="px-4 py-3 font-mono text-xs">{c.customer_number}</td>
                    <td className="px-4 py-3 font-medium">{c.full_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{c.national_id || "—"}</td>
                    <td className="px-4 py-3 capitalize">{c.customer_type}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                    <td className="px-4 py-3"><KycBadge status={c.kyc_status} /></td>
                    <td className="px-4 py-3"><CreditScoreBadge score={c.credit_score ?? 650} /></td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        customer={c}
                        onView={() => setDetailCustomer(c)}
                        onVerify={() => updateKyc.mutate({ id: c.id, status: "verified" })}
                        onReject={() => updateKyc.mutate({ id: c.id, status: "rejected" })}
                        onDelete={canDelete ? () => deleteCustomer.mutate(c.id) : undefined}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <CustomerDetailDialog customer={detailCustomer} open={!!detailCustomer} onOpenChange={(o) => !o && setDetailCustomer(null)} />
    </AppShell>
  );
}

function Field({ label, name, type = "text", required, defaultValue }: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}{required && " *"}</Label>
      <Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} />
    </div>
  );
}

function KycBadge({ status }: { status: string }) {
  if (status === "verified") return <Badge className="bg-success text-success-foreground hover:bg-success"><ShieldCheck className="h-3 w-3 mr-1" />Verified</Badge>;
  if (status === "rejected") return <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" />Rejected</Badge>;
  return <Badge variant="secondary"><ShieldQuestion className="h-3 w-3 mr-1" />Pending</Badge>;
}

function CreditScoreBadge({ score }: { score: number }) {
  const tone = score >= 720 ? "bg-success/15 text-success" : score >= 600 ? "bg-primary-soft text-primary" : score >= 500 ? "bg-warning/15 text-warning-foreground" : "bg-destructive/15 text-destructive";
  const label = score >= 720 ? "Excellent" : score >= 600 ? "Good" : score >= 500 ? "Fair" : "Poor";
  return <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium " + tone}><span className="font-mono">{score}</span><span className="opacity-70">{label}</span></span>;
}

type CustomerRow = { id: string; full_name: string; phone: string | null; email: string | null; address: string | null; city: string | null; occupation: string | null; national_id: string | null };

function CustomerEditDialog({ customer, open, onOpenChange }: { customer: CustomerRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async (fd: FormData) => {
      const d = Object.fromEntries(fd.entries()) as Record<string, string>;
      const { error } = await supabase.from("customers").update({
        full_name: d.full_name, phone: d.phone || null, email: d.email || null,
        address: d.address || null, city: d.city || null, occupation: d.occupation || null,
        national_id: d.national_id || null,
      }).eq("id", customer.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Customer updated"); qc.invalidateQueries({ queryKey: ["customers"] }); onOpenChange(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit customer — {customer.full_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate(new FormData(e.currentTarget)); }}>
            <Field label="Full name" name="full_name" required defaultValue={customer.full_name} />
            <Field label="National ID" name="national_id" defaultValue={customer.national_id ?? ""} />
            <Field label="Phone" name="phone" defaultValue={customer.phone ?? ""} />
            <Field label="Email" name="email" type="email" defaultValue={customer.email ?? ""} />
            <Field label="City" name="city" defaultValue={customer.city ?? ""} />
            <Field label="Occupation" name="occupation" defaultValue={customer.occupation ?? ""} />
            <div className="space-y-2"><Label>Address</Label><Textarea name="address" rows={2} defaultValue={customer.address ?? ""} /></div>
            <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button>
          </form>
          <div>
            <h4 className="text-sm font-semibold mb-2">KYC documents</h4>
            <KycUpload customerId={customer.id} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ customer, onView, onVerify, onReject, onDelete }: {
  customer: CustomerRow & { kyc_status?: string };
  onView: () => void;
  onVerify: () => void;
  onReject: () => void;
  onDelete?: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem onClick={onView}><Eye className="h-4 w-4 mr-2" />View details</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onVerify}><CheckCircle2 className="h-4 w-4 mr-2" />Verify KYC</DropdownMenuItem>
          <DropdownMenuItem onClick={onReject}><XCircle className="h-4 w-4 mr-2" />Reject KYC</DropdownMenuItem>
          {onDelete && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomerEditDialog customer={customer} open={editOpen} onOpenChange={setEditOpen} />
      {onDelete && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {customer.full_name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the customer record. Accounts, loans and KYC documents that reference this customer may block the delete if present.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
