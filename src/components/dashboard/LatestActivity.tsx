import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus, RefreshCcw, FileText, User } from "lucide-react";
import { sql } from "@/lib/sql-client";

type Activity = {
  key: string;
  at: string;
  icon: typeof Plus;
  tone: "success" | "info" | "warn";
  actor?: string | null;
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
        sql
          .from("loans")
          .select("id, loan_number, principal, status, created_at, disbursement_date, created_by, customer:customers!loans_customer_fk(id, full_name)")
          .order("created_at", { ascending: false })
          .limit(8),
        sql
          .from("loan_repayments")
          .select("id, amount, paid_at, created_at, posted_by, loan:loans!loan_repayments_loan_fk(id, loan_number, customer:customers!loans_customer_fk(id, full_name))")
          .order("created_at", { ascending: false })
          .limit(8),
        sql
          .from("customers")
          .select("id, full_name, created_at, created_by")
          .order("created_at", { ascending: false })
          .limit(6),
        sql
          .from("transactions")
          .select("id, amount, txn_type, created_at, performed_by, account:accounts!transactions_account_fk(id, account_number, customer:customers!accounts_customer_fk(id, full_name))")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      // Build user lookup
      const ids = new Set<string>();
      for (const l of loans.data ?? []) if (l.created_by) ids.add(l.created_by as string);
      for (const r of reps.data ?? []) if (r.posted_by) ids.add(r.posted_by as string);
      for (const c of custs.data ?? []) if (c.created_by) ids.add(c.created_by as string);
      for (const t of txs.data ?? []) if (t.performed_by) ids.add(t.performed_by as string);
      const userMap: Record<string, string> = {};
      if (ids.size) {
        const { data: profs } = await sql
          .from("profiles")
          .select("id, full_name, email")
          .in("id", Array.from(ids));
        for (const p of profs ?? []) userMap[p.id] = p.full_name || p.email || "User";
      }
      const nameFor = (id: string | null | undefined) =>
        id ? userMap[id] ?? "Staff" : "System";

      const out: Activity[] = [];

      for (const l of loans.data ?? []) {
        const c: any = l.customer;
        out.push({
          key: `loan-${l.id}`,
          at: l.created_at as string,
          icon: Plus,
          tone: "success",
          actor: nameFor(l.created_by as string | null),
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
          actor: nameFor(r.posted_by as string | null),
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
          actor: nameFor(c.created_by as string | null),
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
          actor: nameFor(t.performed_by as string | null),
          nodes: (
            <>
              {t.txn_type ?? "Transaction"} of{" "}
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
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> by <span className="font-medium text-foreground/80">{a.actor ?? "System"}</span>
                    </span>
                    <span>•</span>
                    <span>{timeAgo(a.at)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
