import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Factor = { id: string; status: string; friendly_name?: string | null; factor_type: string };

export function MfaEnroll() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors([...(data?.totp ?? [])] as Factor[]);
  };
  useEffect(() => { refresh(); }, []);

  const verified = factors.filter((f) => f.status === "verified");

  const startEnroll = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${Date.now()}` });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const finishEnroll = async () => {
    if (!enrolling) return;
    setBusy(true);
    const { data: chal, error: cerr } = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
    if (cerr || !chal) { setBusy(false); return toast.error(cerr?.message ?? "Challenge failed"); }
    const { error } = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: chal.id, code });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("MFA enabled");
    setEnrolling(null); setCode(""); refresh();
  };

  const removeFactor = async (id: string) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return toast.error(error.message);
    toast.success("Factor removed"); refresh();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold flex items-center gap-2">
          {verified.length > 0 ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-warning-foreground" />}
          Two-factor authentication (TOTP)
        </h3>
        <Badge variant={verified.length > 0 ? "default" : "secondary"}>
          {verified.length > 0 ? "Active" : "Not enabled"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Required for privileged actions: reversing repayments and editing the chart of accounts.
      </p>

      {factors.length > 0 && (
        <ul className="space-y-2 mb-4">
          {factors.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm border border-border rounded p-2">
              <span className="flex-1">{f.friendly_name || f.factor_type}</span>
              <Badge variant={f.status === "verified" ? "default" : "secondary"}>{f.status}</Badge>
              <Button size="sm" variant="outline" onClick={() => removeFactor(f.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}

      {enrolling ? (
        <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/30">
          <div className="text-sm">Scan in your authenticator app, then enter the 6-digit code.</div>
          <img src={enrolling.qr} alt="MFA QR" className="h-44 w-44 bg-white p-2 rounded" />
          <div className="text-xs text-muted-foreground font-mono break-all">Secret: {enrolling.secret}</div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">6-digit code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="font-mono" />
            </div>
            <Button disabled={code.length !== 6 || busy} onClick={finishEnroll}>Verify</Button>
            <Button variant="outline" onClick={() => { setEnrolling(null); setCode(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button onClick={startEnroll} disabled={busy}>
          {verified.length > 0 ? "Add another device" : "Enable two-factor"}
        </Button>
      )}
    </div>
  );
}
