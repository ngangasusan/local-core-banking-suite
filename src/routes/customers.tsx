import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ShieldCheck, ShieldAlert, ShieldQuestion, Pencil } from "lucide-react";
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
  national_id: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  occupation: z.string().trim().max(80).optional().or(z.literal("")),
  monthly_income: z.string().optional(),
  kyc_notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function CustomersPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

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
      const customer_number = "C" + Date.now().toString().slice(-9);
      const { error } = await supabase.from("customers").insert({
        customer_number,
        full_name: parsed.full_name,
        customer_type: parsed.customer_type,
        national_id: parsed.national_id || null,
        email: parsed.email || null,
        phone: parsed.phone || null,
        address: parsed.address || null,
        city: parsed.city || null,
        occupation: parsed.occupation || null,
        monthly_income: parsed.monthly_income ? Number(parsed.monthly_income) : null,
        kyc_notes: parsed.kyc_notes || null,
        created_by: user!.id,
      });
      if (error) throw error;
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
              <DialogContent className="max-w-2xl">
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
                  <Field label="National ID / Reg #" name="national_id" />
                  <Field label="Email" name="email" type="email" />
                  <Field label="Phone" name="phone" />
                  <Field label="City" name="city" />
                  <Field label="Occupation" name="occupation" />
                  <Field label="Monthly income (KES)" name="monthly_income" type="number" />
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
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">KYC</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No customers yet. Create your first one.</td></tr>
                )}
                {customers.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{c.customer_number}</td>
                    <td className="px-4 py-3 font-medium">{c.full_name}</td>
                    <td className="px-4 py-3 capitalize">{c.customer_type}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                    <td className="px-4 py-3"><KycBadge status={c.kyc_status} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => updateKyc.mutate({ id: c.id, status: "verified" })}>Verify</Button>
                        <Button size="sm" variant="ghost" onClick={() => updateKyc.mutate({ id: c.id, status: "rejected" })}>Reject</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, name, type = "text", required }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}{required && " *"}</Label>
      <Input id={name} name={name} type={type} required={required} />
    </div>
  );
}

function KycBadge({ status }: { status: string }) {
  if (status === "verified") return <Badge className="bg-success text-success-foreground hover:bg-success"><ShieldCheck className="h-3 w-3 mr-1" />Verified</Badge>;
  if (status === "rejected") return <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" />Rejected</Badge>;
  return <Badge variant="secondary"><ShieldQuestion className="h-3 w-3 mr-1" />Pending</Badge>;
}
