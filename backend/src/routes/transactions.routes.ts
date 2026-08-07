import { Router } from "express";
import { z } from "zod";
import { tx, type RowDataPacket } from "../db.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ah } from "../util/asyncRoute.js";
import { newId } from "../util/uuid.js";
import { writeAudit } from "../services/audit.js";
import { COA, getCoaId, postJE } from "../services/accounting.js";

const r = Router();
r.use(requireAuth);

const Body = z.object({
  txn_type: z.enum(["deposit", "withdrawal", "transfer"]),
  amount: z.coerce.number().positive(),
  account_id: z.string().min(1),
  counterparty_account_id: z.string().min(1).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  reference: z.string().max(64).optional(),
});

type AcctRow = RowDataPacket & { id: string; balance: string; status: string };

r.post("/", requireRole("admin", "super_admin", "manager", "teller", "finance_officer"),
  ah(async (req, res) => {
    const b = Body.parse(req.body);
    if (b.txn_type === "transfer" && !b.counterparty_account_id)
      return res.status(400).json({ error: "counterparty_required" });
    if (b.txn_type === "transfer" && b.counterparty_account_id === b.account_id)
      return res.status(400).json({ error: "same_account" });

    const userId = req.user!.sub;
    const reference = b.reference || `TX${Date.now()}`;
    const amount = Math.round(b.amount * 100) / 100;

    const out = await tx(async (cx) => {
      const ids = b.txn_type === "transfer" ? [b.account_id, b.counterparty_account_id!] : [b.account_id];
      const [rows] = await cx.query<AcctRow[]>(
        `SELECT id, balance, status FROM accounts WHERE id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`,
        ids
      );
      const src = rows.find((x) => x.id === b.account_id);
      if (!src) throw Object.assign(new Error("account_not_found"), { status: 404 });
      if (src.status !== "active") throw Object.assign(new Error("account_not_active"), { status: 409 });
      const srcBal = Number(src.balance);

      if (b.txn_type === "deposit") {
        await cx.query("UPDATE accounts SET balance = ROUND(balance + ?, 2) WHERE id = ?", [amount, src.id]);
      } else {
        if (srcBal < amount) throw Object.assign(new Error("insufficient_balance"), { status: 409 });
        await cx.query("UPDATE accounts SET balance = ROUND(balance - ?, 2) WHERE id = ?", [amount, src.id]);
      }

      if (b.txn_type === "transfer") {
        const dst = rows.find((x) => x.id === b.counterparty_account_id);
        if (!dst) throw Object.assign(new Error("destination_not_found"), { status: 404 });
        if (dst.status !== "active") throw Object.assign(new Error("destination_not_active"), { status: 409 });
        await cx.query("UPDATE accounts SET balance = ROUND(balance + ?, 2) WHERE id = ?", [amount, dst.id]);
      }

      const id = newId();
      await cx.query(
        `INSERT INTO transactions
           (id, reference, txn_type, amount, account_id, counterparty_account_id, status, description, performed_by)
         VALUES (?,?,?,ROUND(?,2),?,?,'completed',?,?)`,
        [id, reference, b.txn_type, amount, b.account_id, b.counterparty_account_id ?? null,
         b.description ?? null, userId]
      );

      // Double-entry: cash vs customer deposits (transfers net to zero on the GL).
      if (b.txn_type !== "transfer") {
        const cash = await getCoaId(cx, COA.CASH);
        const deposits = await getCoaId(cx, COA.CUSTOMER_DEPOSITS);
        await postJE(cx, {
          entryDate: new Date().toISOString().slice(0, 10),
          reference,
          description: `${b.txn_type} ${reference}`,
          debitAccountId: b.txn_type === "deposit" ? cash : deposits,
          creditAccountId: b.txn_type === "deposit" ? deposits : cash,
          amount,
          sourceTable: "transactions",
          sourceId: id,
          createdBy: userId,
        });
      }
      return { id, reference };
    });

    await writeAudit({
      userId, action: "INSERT", table: "transactions", recordId: out.id,
      newData: { ...b, id: out.id, reference: out.reference },
    });
    res.status(201).json(out);
  }));

export default r;
