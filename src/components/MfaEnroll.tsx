import { useEffect, useState } from "react";
import { api, fetchMe } from "@/lib/api";
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
    const me = await fetchMe();
    setFactors(me?.mfa_enrolled ? [{ id: "totp", status: "verified", factor_type: "Authenticator app" }] : []);
  };
  useEffect(() => { refresh(); }, []);

  const verified = factors.filter((f) => f.status === "verified");

  const startEnroll = async () => {
    setBusy(true);
    try {
      const data = await api.post<{ secret: string; qr_code: string }>("/auth/mfa/enroll/start");
      setEnrolling({ id: "totp", qr: data.qr_code, secret: data.secret });
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  const finishEnroll = async () => {
    if (!enrolling) return;
    setBusy(true);
    try {
      await api.post("/auth/mfa/enroll/finish", { code });
    } catch (e) {
      setBusy(false);
      return toast.error((e as Error).message);
    }
    setBusy(false);
    toast.success("MFA enabled");
    setEnrolling(null); setCode(""); refresh();
  };

  const removeFactor = async (_id: string) => {
    try {
      await api.post("/auth/mfa/disable");
    } catch (e) {
      return toast.error((e as Error).message);
    }
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
