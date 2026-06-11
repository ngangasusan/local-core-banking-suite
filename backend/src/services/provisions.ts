// IFRS9-style Expected Credit Loss provisioning. Buckets by DPD:
//   Stage 1: 0-30 dpd       PD=2%
//   Stage 2: 31-90 dpd      PD=20%
//   Stage 3: 90+ dpd        PD=100%
// LGD default 45%. ECL = exposure * PD * LGD.
import { pool, type RowDataPacket } from "../db.js";

function stageFor(dpd: number): { stage: 1 | 2 | 3; pd: number } {
  if (dpd <= 30) return { stage: 1, pd: 0.02 };
  if (dpd <= 90) return { stage: 2, pd: 0.20 };
  return { stage: 3, pd: 1.0 };
}

export interface ProvisionRow {
  loan_id: string; stage: number; dpd: number; exposure: number;
  pd_rate: number; lgd_rate: number; ecl_amount: number;
}

export async function recomputeProvisions(): Promise<{ updated: number; total_ecl: number }> {
  const [loans] = await pool().query<(RowDataPacket & {
    id: string; outstanding_balance: string; due_date: string | null; status: string;
  })[]>(
    `SELECT id, outstanding_balance, due_date, status
       FROM loans
      WHERE status IN ('active','in_arrears','disbursed') AND outstanding_balance > 0`
  );

  let total = 0;
  for (const l of loans) {
    const exposure = Number(l.outstanding_balance);
    const dpd = l.due_date
      ? Math.max(0, Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86_400_000))
      : 0;
    const { stage, pd } = stageFor(dpd);
    const lgd = 0.45;
    const ecl = Math.round(exposure * pd * lgd * 100) / 100;
    total += ecl;
    await pool().query(
      `INSERT INTO loan_provisions (loan_id, stage, dpd, exposure, pd_rate, lgd_rate, ecl_amount, computed_at)
       VALUES (?, ?, ?, ROUND(?,2), ?, ?, ROUND(?,2), NOW(3))
       ON DUPLICATE KEY UPDATE
         stage = VALUES(stage), dpd = VALUES(dpd), exposure = VALUES(exposure),
         pd_rate = VALUES(pd_rate), lgd_rate = VALUES(lgd_rate),
         ecl_amount = VALUES(ecl_amount), computed_at = NOW(3)`,
      [l.id, stage, dpd, exposure, pd, lgd, ecl]
    );
  }
  return { updated: loans.length, total_ecl: Math.round(total * 100) / 100 };
}
