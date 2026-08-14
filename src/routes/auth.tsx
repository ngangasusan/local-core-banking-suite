import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { USE_NODE_API, ApiError, login as apiLogin, verifyMfa, bootstrap as apiBootstrap } from "@/lib/api";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — CoreBank" },
      { name: "description", content: "Sign in to the CoreBank operations console." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiLogin(email || "demo@corebank.local", password);
      await refresh();
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft via-background to-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="h-11 w-11 rounded-xl bg-primary flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">CoreBank</div>
            <div className="text-xs text-muted-foreground">Operations Console</div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm p-6">
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1">
              <div className="font-medium">Sign in</div>
              <div className="text-xs text-muted-foreground">
                Authentication is temporarily disabled — any details will get you in.
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="demo@corebank.local" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Continue"}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

