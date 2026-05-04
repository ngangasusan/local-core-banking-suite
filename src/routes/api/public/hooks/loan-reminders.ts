import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

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

        const url = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const sb = createClient(url!, token, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // 1) Mark overdue loans
        await sb.rpc("mark_overdue_loans");

        // 2) Find loans needing reminders
        const today = new Date();
        const in3 = new Date(today.getTime() + 3 * 86400000);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);

        const { data: loans, error } = await sb
          .from("loans")
          .select(
            "id, loan_number, due_date, outstanding_balance, status, customer:customers!loans_customer_fk(id, full_name, phone, email)"
          )
          .in("status", ["active", "in_arrears"])
          .gt("outstanding_balance", 0)
          .or(`due_date.eq.${fmt(today)},due_date.eq.${fmt(in3)},due_date.lt.${fmt(today)}`);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

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
            await sb.from("sms_queue").insert({
              to_phone: customer.phone,
              message: body,
              customer_id: customer.id,
              loan_id: l.id,
            });
            queued++;
          }
          if (customer.email) {
            await sb.from("email_queue").insert({
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
