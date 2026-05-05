import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/audit")({
  head: () => ({ meta: [{ title: "Audit Log — CoreBank" }] }),
  component: AuditPage,
});

function AuditPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const [table, setTable] = useState<string>("all");
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const isPrivileged = hasRole("admin") || hasRole("super_admin") || hasRole("auditor");

  const { data: logs = [] } = useQuery({
    queryKey: ["audit-log", table],
    enabled: !!user && isPrivileged,
    queryFn: async () => {
      let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
      if (table !== "all") q = q.eq("table_name", table);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  if (loading || !user) return null;
  if (!isPrivileged) {
    return (
      <AppShell>
        <div className="p-10 text-center text-muted-foreground">You do not have access to the audit log.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="Audit Log"
          description="Full trail of system actions."
          actions={
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tables</SelectItem>
                <SelectItem value="customers">Customers</SelectItem>
                <SelectItem value="loans">Loans</SelectItem>
                <SelectItem value="transactions">Transactions</SelectItem>
                <SelectItem value="user_roles">User roles</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">When</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Table</th>
                <th className="text-left px-4 py-3 font-medium">Record</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No audit entries.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge variant={l.action === "DELETE" ? "destructive" : l.action === "INSERT" ? "default" : "secondary"}>{l.action}</Badge></td>
                  <td className="px-4 py-3">{l.table_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.record_id?.slice(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.user_id?.slice(0, 8) ?? "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
