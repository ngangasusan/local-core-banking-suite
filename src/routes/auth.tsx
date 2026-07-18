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
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<{ preAuth: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (USE_NODE_API) {
        const res = await apiLogin(email, password);
        if (res.kind === "mfa") setMfaChallenge({ preAuth: res.pre_auth_token });
        else { await refresh(); navigate({ to: "/" }); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) toast.error(error.message);
        else navigate({ to: "/" });
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.code ?? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallenge) return;
    setBusy(true);
    try {
      await verifyMfa(mfaCode, mfaChallenge.preAuth);
      await refresh();
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.code ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (USE_NODE_API) {
        // Bootstrap only works for the very first user; admins create staff via /users.
        await apiBootstrap(email, password, fullName);
        toast.success("Super-admin created. You can now sign in.");
        setTab("signin");
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { full_name: fullName } },
        });
        if (error) toast.error(error.message);
        else { toast.success("Account created. You can now sign in."); setTab("signin"); }
      }
    } catch (e) {
      const msg = e instanceof ApiError ? (e.code === "already_bootstrapped" ? "System already has users — ask an admin to create your account." : e.code ?? e.message) : (e as Error).message;
      toast.error(msg);
    } finally { setBusy(false); }
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
            <div className="text-xs text-muted-foreground">Operations Console {USE_NODE_API ? "· Node API" : ""}</div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-sm p-6">
          {mfaChallenge ? (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="space-y-1">
                <div className="font-medium">Two-factor authentication</div>
                <div className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app.</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mfa">Code</Label>
                <Input id="mfa" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Verifying…" : "Verify & continue"}</Button>
              <button type="button" className="text-xs text-muted-foreground w-full text-center hover:text-foreground" onClick={() => { setMfaChallenge(null); setMfaCode(""); }}>← Back to sign in</button>
            </form>
          ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">{USE_NODE_API ? "First-run bootstrap" : "Create account"}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2">Work email</Label>
                  <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">Password</Label>
                  <Input id="password2" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : USE_NODE_API ? "Bootstrap super-admin" : "Create account"}</Button>
                <p className="text-xs text-muted-foreground text-center">
                  {USE_NODE_API
                    ? "Only works when no users exist yet. Otherwise ask an admin to create your account."
                    : <>First account becomes <span className="font-medium">admin</span>. Subsequent users default to teller.</>}
                </p>
              </form>
            </TabsContent>
          </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
