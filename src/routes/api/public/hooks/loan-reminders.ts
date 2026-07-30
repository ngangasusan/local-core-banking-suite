import { createFileRoute } from "@tanstack/react-router";


// Generates loan reminder notifications + queues SMS/Email
// Triggered daily by pg_cron. Rules:
//   - 3 days before due date
//   - On the due date
//   - Every day after overdue until paid
export const Route = createFileRoute("/api/public/hooks/loan-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        if (!token) return new Response("Missing auth", { status: 401 });

        const base = (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");
        const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
          const res = await fetch(`${base}${path}`, {
            ...init,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
          });
          if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
          return (await res.json()) as T;
        };
        const sb = {
          rpc: (name: string, args: Record<string, unknown> = {}) =>
            call(`/rpc/${name}`, { method: "POST", body: JSON.stringify(args) }),
          select: (table: string, qs: string) =>
            call<{ rows: Record<string, unknown>[] }>(`/data/${table}?${qs}`),
          insert: (table: string, row: Record<string, unknown>) =>
            call(`/data/${table}`, { method: "POST", body: JSON.stringify(row) }),
        };

        // 1) Mark overdue loans
        await sb.rpc("mark_overdue_loans");

        // 2) Find loans needing reminders
        const today = new Date();
        const in3 = new Date(today.getTime() + 3 * 86400000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);

        const params = new URLSearchParams();
        params.set("select", "id, loan_number, due_date, outstanding_balance, status, customer:customers!loans_customer_fk(id, full_name, phone, email)");
        params.append("status", "in.(active,in_arrears)");
        params.append("outstanding_balance", "gt.0");
        params.append("or", `(due_date.eq.${fmt(today)},due_date.eq.${fmt(in3)},due_date.lt.${fmt(today)})`);
        const loans = (await sb.select("loans", params.toString())).rows as Record<string, unknown>[];

        let queued = 0;
        for (const l of loans ?? []) {
          const customerRaw = l.customer as unknown;
          const customer = (Array.isArray(customerRaw) ? customerRaw[0] : customerRaw) as
            | { id: string; full_name: string; phone: string | null; email: string | null }
            | null;
          if (!customer) continue;

          const dueDate = new Date(l.due_date as string);
          const daysOverdue = Math.floor(
            (today.getTime() - dueDate.getTime()) / 86400000
          );
          let category: "upcoming" | "due_today" | "overdue" = "upcoming";
          let title = "";
          if (daysOverdue > 0) {
            category = "overdue";
            title = `Loan ${l.loan_number} overdue by ${daysOverdue} day(s)`;
          } else if (daysOverdue === 0) {
            category = "due_today";
            title = `Loan ${l.loan_number} due today`;
          } else {
            title = `Loan ${l.loan_number} due in 3 days`;
          }

          const body = `Dear ${customer.full_name}, your loan ${l.loan_number} of outstanding ${l.outstanding_balance} is ${category === "overdue" ? `${daysOverdue} day(s) overdue` : category === "due_today" ? "due today" : "due in 3 days"}. Please make payment.`;

          if (customer.phone) {
            await sb.insert("sms_queue", {
              to_phone: customer.phone,
              message: body,
              customer_id: customer.id,
              loan_id: l.id,
            });
            queued++;
          }
          if (customer.email) {
            await sb.insert("email_queue", {
              to_email: customer.email,
              subject: title,
              body,
              customer_id: customer.id,
              loan_id: l.id,
            });
            queued++;
          }
        }

        return new Response(
          JSON.stringify({ ok: true, processed: loans?.length ?? 0, queued }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
});
