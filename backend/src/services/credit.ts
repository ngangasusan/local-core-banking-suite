// Behavioural credit scoring. Mirrors the previous Postgres compute_credit_score
// function. Range 300..850, baseline 650.
//
// Inputs derived from loan history:
//   + on-time closed loans  → +20 each (cap +120)
//   - active arrears         → -25 each
//   - written-off loans      → -80 each
//   - max DPD on active      → -1 per day  (cap -150)
// KYC verified bumps +30, rejected -50.
import { pool, type RowDataPacket } from "../db.js";

export interface CreditScoreBreakdown {
  customer_id: string;
  base: number;
  closed_on_time: number;
  in_arrears: number;
  written_off: number;
  max_dpd: number;
  kyc_status: string;
  score: number;
}

export async function computeCreditScore(customerId: string): Promise<CreditScoreBreakdown> {
  const [crows] = await pool().query<(RowDataPacket & { kyc_status: string })[]>(
    "SELECT kyc_status FROM customers WHERE id = ? LIMIT 1", [customerId]
  );
  const cust = crows[0];
  if (!cust) throw new Error("customer_not_found");

  const [lrows] = await pool().query<(RowDataPacket & {
    closed_on_time: number; in_arrears: number; written_off: number; max_dpd: number;
  })[]>(
    `SELECT
       SUM(CASE WHEN status='closed' AND (due_date IS NULL OR due_date >= CURDATE()) THEN 1 ELSE 0 END) AS closed_on_time,
       SUM(CASE WHEN status='in_arrears' THEN 1 ELSE 0 END) AS in_arrears,
       (SELECT COUNT(*) FROM loan_writeoffs wo
         JOIN loans l2 ON l2.id = wo.loan_id
         WHERE wo.status='applied' AND l2.customer_id = ?) AS written_off,
       COALESCE(MAX(GREATEST(DATEDIFF(CURDATE(), due_date), 0)), 0) AS max_dpd
     FROM loans WHERE customer_id = ?`,
    [customerId, customerId]
  );
  const s = lrows[0] ?? { closed_on_time: 0, in_arrears: 0, written_off: 0, max_dpd: 0 };

  const base = 650;
  let score = base;
  score += Math.min(Number(s.closed_on_time) * 20, 120);
  score -= Number(s.in_arrears) * 25;
  score -= Number(s.written_off) * 80;
  score -= Math.min(Number(s.max_dpd), 150);
  if (cust.kyc_status === "verified") score += 30;
  if (cust.kyc_status === "rejected") score -= 50;
  score = Math.max(300, Math.min(850, score));

  await pool().query(
    "UPDATE customers SET credit_score = ? WHERE id = ?", [score, customerId]
  );

  return {
    customer_id: customerId, base,
    closed_on_time: Number(s.closed_on_time),
    in_arrears: Number(s.in_arrears),
    written_off: Number(s.written_off),
    max_dpd: Number(s.max_dpd),
    kyc_status: cust.kyc_status,
    score,
  };
}
