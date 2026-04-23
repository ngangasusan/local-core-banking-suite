import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — CoreBank" }, { name: "description", content: "Users, roles and institution settings." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, loading, roles } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);

  const { data: users = [] } = useQuery({
    queryKey: ["staff"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*");
      const { data: r } = await supabase.from("user_roles").select("user_id, role");
      return (data ?? []).map((p) => ({ ...p, roles: (r ?? []).filter((x) => x.user_id === p.id).map((x) => x.role) }));
    },
  });

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-5xl mx-auto">
        <PageHeader title="Settings" description="Staff users, roles and your account." />

        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h3 className="font-semibold mb-1">Your account</h3>
          <p className="text-sm text-muted-foreground mb-4">{user.email}</p>
          <div className="flex flex-wrap gap-2">
            {roles.length === 0 ? <Badge variant="secondary">No role assigned</Badge> :
              roles.map((r) => <Badge key={r} className="capitalize">{r.replace("_", " ")}</Badge>)}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl">
          <div className="p-6 border-b border-border">
            <h3 className="font-semibold">Staff directory</h3>
            <p className="text-sm text-muted-foreground">All system users and their assigned roles.</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Branch</th>
                <th className="text-left px-4 py-3 font-medium">Roles</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.branch ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r: string) => <Badge key={r} variant="secondary" className="capitalize">{r.replace("_", " ")}</Badge>)}
                    </div>
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
