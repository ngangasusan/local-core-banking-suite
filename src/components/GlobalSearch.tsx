import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Users, Banknote, Wallet, Loader2 } from "lucide-react";
import { sql } from "@/lib/sql-client";

type Hit = {
  group: "Customers" | "Loans" | "Accounts";
  id: string;
  title: string;
  subtitle?: string;
  to: string;
};

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        (document.getElementById("global-search-input") as HTMLInputElement | null)?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced search
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const like = `%${term}%`;
        const [customersRes, loansRes, accountsRes] = await Promise.all([
          sql
            .from("customers")
            .select("id, full_name, national_id, phone")
            .or(`full_name.ilike.${like},national_id.ilike.${like},phone.ilike.${like}`)
            .limit(6),
          sql
            .from("loans")
            .select("id, loan_number, principal, status, customer:customers!loans_customer_fk(full_name)")
            .ilike("loan_number", like)
            .limit(6),
          sql
            .from("accounts")
            .select("id, account_number, account_type, customer:customers!accounts_customer_fk(full_name)")
            .ilike("account_number", like)
            .limit(6),
        ]);

        const results: Hit[] = [];
        (customersRes.data ?? []).forEach((c: any) =>
          results.push({
            group: "Customers",
            id: c.id,
            title: c.full_name,
            subtitle: [c.national_id, c.phone].filter(Boolean).join(" • "),
            to: `/customers?focus=${c.id}`,
          }),
        );
        (loansRes.data ?? []).forEach((l: any) =>
          results.push({
            group: "Loans",
            id: l.id,
            title: l.loan_number,
            subtitle: `${l.customer?.full_name ?? "—"} • ${l.status}`,
            to: `/loans?focus=${l.id}`,
          }),
        );
        (accountsRes.data ?? []).forEach((a: any) =>
          results.push({
            group: "Accounts",
            id: a.id,
            title: a.account_number,
            subtitle: `${a.customer?.full_name ?? "—"} • ${a.account_type}`,
            to: `/accounts?focus=${a.id}`,
          }),
        );
        setHits(results);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [q]);

  const grouped = useMemo(() => {
    const map: Record<string, Hit[]> = {};
    hits.forEach((h) => {
      (map[h.group] ||= []).push(h);
    });
    return map;
  }, [hits]);

  const iconFor = (g: Hit["group"]) =>
    g === "Customers" ? Users : g === "Loans" ? Banknote : Wallet;

  const go = (to: string) => {
    setOpen(false);
    setQ("");
    navigate({ to });
  };

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          id="global-search-input"
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          placeholder="Search customers, loans, accounts…"
          className="w-full h-9 pl-8 pr-12 rounded-md bg-background/60 border border-sidebar-border text-sm text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
        <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center h-5 px-1.5 rounded text-[10px] text-muted-foreground bg-muted/50 border border-border">
          /
        </kbd>
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-[420px] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          )}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No results for "{q}"</div>
          )}
          {!loading &&
            Object.entries(grouped).map(([group, items]) => {
              const Icon = iconFor(group as Hit["group"]);
              return (
                <div key={group} className="py-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group}
                  </div>
                  {items.map((h) => (
                    <button
                      key={`${group}-${h.id}`}
                      onClick={() => go(h.to)}
                      className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">{h.title}</div>
                        {h.subtitle && (
                          <div className="text-xs text-muted-foreground truncate">{h.subtitle}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
