import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus, RefreshCcw, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Activity = {
  key: string;
  at: string;
  icon: typeof Plus;
  tone: "success" | "info" | "warn";
  nodes: React.ReactNode;
};

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function LatestActivity() {
  const { data = [] } = useQuery({
    queryKey: ["dashboard-activity"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Activity[]> => {
      const [loans, reps, custs, txs] = await Promise.all([
        supabase
          .from("loans")
          .select("id, loan_number, principal, status, created_at, disbursement_date, customer:customers!loans_customer_fk(id, full_name)")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("loan_repayments")
          .select("id, amount, paid_at, created_at, loan:loans!loan_repayments_loan_fk(id, loan_number, customer:customers!loans_customer_fk(id, full_name))")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("customers")
          .select("id, full_name, created_at")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("transactions")
          .select("id, amount, txn_type, created_at, account:accounts!transactions_account_fk(id, account_number, customer:customers!accounts_customer_fk(id, full_name))")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      const out: Activity[] = [];

      for (const l of loans.data ?? []) {
        const c: any = l.customer;
        out.push({
          key: `loan-${l.id}`,
          at: l.created_at as string,
          icon: Plus,
          tone: "success",
          nodes: (
            <>
              <Link to="/loans" search={{ focus: l.id } as any} className="text-primary hover:underline font-medium">
                Loan {l.loan_number}
              </Link>{" "}
              was created for{" "}
              {c?.id ? (
                <Link to="/customers" search={{ focus: c.id } as any} className="text-primary hover:underline">
                  {c.full_name}
                </Link>
              ) : (
                <span>{c?.full_name ?? "—"}</span>
              )}
            </>
          ),
        });
      }

      for (const r of reps.data ?? []) {
        const loan: any = r.loan;
        const c: any = loan?.customer;
        out.push({
          key: `rep-${r.id}`,
          at: (r.created_at ?? r.paid_at) as string,
          icon: CheckCircle2,
          tone: "success",
          nodes: (
            <>
              Repayment of <span className="font-mono">{Number(r.amount).toLocaleString()}</span> posted to{" "}
              {loan?.id ? (
                <Link to="/loans" search={{ focus: loan.id } as any} className="text-primary hover:underline font-medium">
                  Loan {loan.loan_number}
                </Link>
              ) : (
                "loan"
              )}
              {c?.full_name && (
                <>
                  {" "}for{" "}
                  <Link to="/customers" search={{ focus: c.id } as any} className="text-primary hover:underline">
                    {c.full_name}
                  </Link>
                </>
              )}
            </>
          ),
        });
      }

      for (const c of custs.data ?? []) {
        out.push({
          key: `cust-${c.id}`,
          at: c.created_at as string,
          icon: Plus,
          tone: "info",
          nodes: (
            <>
              New customer{" "}
              <Link to="/customers" search={{ focus: c.id } as any} className="text-primary hover:underline font-medium">
                {c.full_name}
              </Link>{" "}
              was onboarded
            </>
          ),
        });
      }

      for (const t of txs.data ?? []) {
        const a: any = t.account;
        const c: any = a?.customer;
        out.push({
          key: `tx-${t.id}`,
          at: t.created_at as string,
          icon: RefreshCcw,
          tone: "info",
          nodes: (
            <>
              {t.transaction_type ?? "Transaction"} of{" "}
              <span className="font-mono">{Number(t.amount).toLocaleString()}</span> on{" "}
              {a?.id ? (
                <Link to="/accounts" search={{ focus: a.id } as any} className="text-primary hover:underline font-medium">
                  {a.account_number}
                </Link>
              ) : (
                "account"
              )}
              {c?.full_name && (
                <>
                  {" • "}
                  <Link to="/customers" search={{ focus: c.id } as any} className="text-primary hover:underline">
                    {c.full_name}
                  </Link>
                </>
              )}
            </>
          ),
        });
      }

      return out
        .filter((a) => a.at)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 12);
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> LATEST ACTIVITY
        </h3>
      </div>
      {data.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">No recent activity.</div>
      ) : (
        <ul className="space-y-4">
          {data.map((a) => {
            const Icon = a.icon;
            const tone =
              a.tone === "success"
                ? "bg-success/10 text-success"
                : a.tone === "warn"
                ? "bg-warning/15 text-warning-foreground"
                : "bg-primary-soft text-primary";
            return (
              <li key={a.key} className="flex gap-3">
                <div className={"h-7 w-7 rounded-full flex items-center justify-center shrink-0 " + tone}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 text-sm">
                  <div className="text-foreground">{a.nodes}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{timeAgo(a.at)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
