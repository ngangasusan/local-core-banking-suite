import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const ALL_ROLES: AppRole[] = ["super_admin", "admin", "manager", "loan_officer", "finance_officer", "teller", "auditor"];

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "User Management — CoreBank" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  const isAdmin = hasRole("admin") || hasRole("super_admin");

  if (loading || !user) return null;
  if (!isAdmin) {
    return <AppShell><div className="p-10 text-center text-muted-foreground">Admins only.</div></AppShell>;
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-10 max-w-7xl mx-auto">
        <PageHeader
          title="User Management"
          description="Manage staff users, roles, and role permissions."
          actions={<CreateUserDialog />}
        />
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="permissions">Role Permissions</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-6"><UsersTab /></TabsContent>
          <TabsContent value="permissions" className="mt-6"><PermissionsTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function CreateUserDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole>("teller");

  const create = useMutation({
    mutationFn: async (fd: FormData) => {
      const payload = {
        full_name: String(fd.get("full_name") || ""),
        email: String(fd.get("email") || ""),
        password: String(fd.get("password") || ""),
        role,
      };
      if (payload.password.length < 8) throw new Error("Password must be at least 8 characters");
      const { data, error } = await supabase.functions.invoke("admin-create-user", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users-list"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New user</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create staff user</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(new FormData(e.currentTarget)); }}>
          <div className="space-y-2"><Label>Full name</Label><Input name="full_name" required /></div>
          <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" required /></div>
          <div className="space-y-2"><Label>Temporary password</Label><Input name="password" type="text" required minLength={8} /></div>
          <div className="space-y-2">
            <Label>Initial role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const qc = useQueryClient();

  const { data: users = [] } = useQuery({
    queryKey: ["users-list"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*");
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
      }));
    },
  });

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("User updated"); qc.invalidateQueries({ queryKey: ["users-list"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role assigned"); qc.invalidateQueries({ queryKey: ["users-list"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role removed"); qc.invalidateQueries({ queryKey: ["users-list"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <div className="p-4 border-b border-border text-sm text-muted-foreground">
        New users sign up via the auth page; assign roles here. Deactivating disables the profile (sign-in is still possible — for full disable, remove all roles).
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Name</th>
            <th className="text-left px-4 py-3 font-medium">Roles</th>
            <th className="text-left px-4 py-3 font-medium">Active</th>
            <th className="text-right px-4 py-3 font-medium">Add role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-border align-top">
              <td className="px-4 py-3">
                <div className="font-medium">{u.full_name}</div>
                <div className="text-xs text-muted-foreground">{u.branch ?? "—"}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {u.roles.length === 0 && <span className="text-xs text-muted-foreground">no roles</span>}
                  {u.roles.map((r) => (
                    <Badge key={r} variant="secondary" className="capitalize cursor-pointer" onClick={() => removeRole.mutate({ userId: u.id, role: r })} title="Click to remove">
                      {r.replace("_", " ")} ✕
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                <Switch checked={u.is_active ?? true} onCheckedChange={(v) => setActive.mutate({ id: u.id, active: v })} />
              </td>
              <td className="px-4 py-3 text-right">
                <AssignRole onAssign={(role) => addRole.mutate({ userId: u.id, role })} existing={u.roles} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignRole({ onAssign, existing }: { onAssign: (r: AppRole) => void; existing: AppRole[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole | "">("");
  const available = ALL_ROLES.filter((r) => !existing.includes(r));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" disabled={available.length === 0}>+ Role</Button></DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Assign role</DialogTitle></DialogHeader>
        <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
          <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
          <SelectContent>
            {available.map((r) => <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button disabled={!role} onClick={() => { if (role) { onAssign(role); setOpen(false); setRole(""); } }}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsTab() {
  const qc = useQueryClient();
  const { data: permissions = [] } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const { data } = await supabase.from("permissions").select("*").order("category").order("code");
      return data ?? [];
    },
  });
  const { data: rolePerms = [] } = useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const { data } = await supabase.from("role_permissions").select("*");
      return data ?? [];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ role, permId, currently }: { role: AppRole; permId: string; currently: boolean }) => {
      if (currently) {
        const { error } = await supabase.from("role_permissions").delete().eq("role", role).eq("permission_id", permId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("role_permissions").insert({ role, permission_id: permId });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const has = (role: AppRole, permId: string) =>
    rolePerms.some((rp) => rp.role === role && rp.permission_id === permId);

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <div className="p-4 border-b border-border text-sm text-muted-foreground">
        Toggle which permissions each role grants. Changes apply immediately.
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 font-medium sticky left-0 bg-muted/50">Permission</th>
            {ALL_ROLES.map((r) => <th key={r} className="px-3 py-3 font-medium capitalize text-center">{r.replace("_", " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {permissions.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="px-4 py-3 sticky left-0 bg-card">
                <div className="font-mono text-xs">{p.code}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </td>
              {ALL_ROLES.map((r) => (
                <td key={r} className="text-center px-3 py-3">
                  <Checkbox
                    checked={has(r, p.id)}
                    onCheckedChange={() => toggle.mutate({ role: r, permId: p.id, currently: has(r, p.id) })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
