// Reports — portfolio, PAR (Portfolio at Risk), aging buckets, P&L, balance sheet.
// Buckets follow CBK/IFRS9 conventions: Current / 1-30 / 31-60 / 61-90 / 90+.
import { query, type RowDataPacket } from "../db.js";

const ACTIVE_LOAN_STATUSES = ["disbursed", "active", "in_arrears"] as const;

export interface PortfolioSummary {
  active_loans: number;
  gross_portfolio: number;
  total_disbursed_ytd: number;
  total_repaid_ytd: number;
  total_writeoffs_ytd: number;
  total_provisions: number;
  par30_amount: number;
  par30_ratio: number;
}

export async function portfolioSummary(): Promise<PortfolioSummary> {
  const status = ACTIVE_LOAN_STATUSES.map(() => "?").join(",");
  const [active] = await query<RowDataPacket & { n: number; gross: string | null }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(outstanding_balance + late_fees), 0) AS gross
       FROM loans WHERE status IN (${status})`,
    [...ACTIVE_LOAN_STATUSES]
  );
  const [ytdDisbursed] = await query<RowDataPacket & { t: string | null }>(
    `SELECT COALESCE(SUM(principal), 0) AS t FROM loans
      WHERE disbursed_at IS NOT NULL AND YEAR(disbursed_at) = YEAR(CURDATE())`
  );
  const [ytdRepaid] = await query<RowDataPacket & { t: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS t FROM loan_repayments
      WHERE reversed = 0 AND YEAR(paid_at) = YEAR(CURDATE())`
  );
  const [ytdWO] = await query<RowDataPacket & { t: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS t FROM loan_writeoffs
      WHERE status = 'applied' AND YEAR(applied_at) = YEAR(CURDATE())`
  );
  const [prov] = await query<RowDataPacket & { t: string | null }>(
    `SELECT COALESCE(SUM(ecl_amount), 0) AS t FROM loan_provisions`
  );
  const [par] = await query<RowDataPacket & { t: string | null }>(
    `SELECT COALESCE(SUM(outstanding_balance + late_fees), 0) AS t
       FROM loans
      WHERE status IN (${status})
        AND due_date IS NOT NULL
        AND DATEDIFF(CURDATE(), due_date) > 30`,
    [...ACTIVE_LOAN_STATUSES]
  );
  const gross = Number(active?.gross ?? 0);
  const par30 = Number(par?.t ?? 0);
  return {
    active_loans: Number(active?.n ?? 0),
    gross_portfolio: gross,
    total_disbursed_ytd: Number(ytdDisbursed?.t ?? 0),
    total_repaid_ytd: Number(ytdRepaid?.t ?? 0),
    total_writeoffs_ytd: Number(ytdWO?.t ?? 0),
    total_provisions: Number(prov?.t ?? 0),
    par30_amount: par30,
    par30_ratio: gross > 0 ? Math.round((par30 / gross) * 10_000) / 10_000 : 0,
  };
}

export interface AgingBucket { bucket: string; loans: number; outstanding: number; }

export async function agingBuckets(): Promise<AgingBucket[]> {
  const status = ACTIVE_LOAN_STATUSES.map(() => "?").join(",");
  const rows = await query<RowDataPacket & {
    bucket: string; loans: number; outstanding: string | null;
  }>(
    `SELECT bucket, COUNT(*) AS loans, COALESCE(SUM(outstanding_balance + late_fees), 0) AS outstanding
       FROM (
         SELECT CASE
           WHEN due_date IS NULL OR DATEDIFF(CURDATE(), due_date) <= 0 THEN 'current'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1  AND 30 THEN '1-30'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN '31-60'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN '61-90'
           ELSE '90+'
         END AS bucket,
         outstanding_balance, late_fees
         FROM loans WHERE status IN (${status})
       ) t
       GROUP BY bucket
       ORDER BY FIELD(bucket, 'current','1-30','31-60','61-90','90+')`,
    [...ACTIVE_LOAN_STATUSES]
  );
  return rows.map((r) => ({
    bucket: r.bucket,
    loans: Number(r.loans),
    outstanding: Number(r.outstanding ?? 0),
  }));
}

// P&L for [from..to] based on journal_entries posted to income / expense COA.
export interface PLRow { code: string; name: string; account_class: string; amount: number; }
export interface PLReport { period: { from: string | null; to: string | null }; income: PLRow[]; expense: PLRow[]; net_income: number; }

export async function profitAndLoss(from: string | null, to: string | null): Promise<PLReport> {
  const filters: string[] = []; const params: unknown[] = [];
  if (from) { filters.push("j.entry_date >= ?"); params.push(from); }
  if (to)   { filters.push("j.entry_date <= ?"); params.push(to); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  // Income = credits - debits on income accounts; Expense = debits - credits on expense accounts.
  const rows = await query<RowDataPacket & {
    code: string; name: string; account_class: string;
    dr: string | null; cr: string | null;
  }>(
    `SELECT coa.code, coa.name, coa.account_class,
            COALESCE(SUM(CASE WHEN j.debit_account  = coa.id THEN j.amount END), 0) AS dr,
            COALESCE(SUM(CASE WHEN j.credit_account = coa.id THEN j.amount END), 0) AS cr
       FROM chart_of_accounts coa
       LEFT JOIN journal_entries j ON (j.debit_account = coa.id OR j.credit_account = coa.id)
       ${where}
      WHERE coa.account_class IN ('income','expense')
      GROUP BY coa.id, coa.code, coa.name, coa.account_class
      ORDER BY coa.code`,
    params
  );
  const income: PLRow[] = [];
  const expense: PLRow[] = [];
  let net = 0;
  for (const r of rows) {
    const dr = Number(r.dr ?? 0), cr = Number(r.cr ?? 0);
    if (r.account_class === "income") {
      const amt = cr - dr;
      income.push({ code: r.code, name: r.name, account_class: r.account_class, amount: amt });
      net += amt;
    } else {
      const amt = dr - cr;
      expense.push({ code: r.code, name: r.name, account_class: r.account_class, amount: amt });
      net -= amt;
    }
  }
  return { period: { from, to }, income, expense, net_income: Math.round(net * 100) / 100 };
}

export interface BalanceSheetRow { code: string; name: string; account_class: string; balance: number; }
export interface BalanceSheet {
  as_of: string | null;
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totals: { assets: number; liabilities: number; equity: number };
}

export async function balanceSheet(asOf: string | null): Promise<BalanceSheet> {
  const filters: string[] = []; const params: unknown[] = [];
  if (asOf) { filters.push("j.entry_date <= ?"); params.push(asOf); }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const rows = await query<RowDataPacket & {
    code: string; name: string; account_class: string;
    dr: string | null; cr: string | null;
  }>(
    `SELECT coa.code, coa.name, coa.account_class,
            COALESCE(SUM(CASE WHEN j.debit_account  = coa.id THEN j.amount END), 0) AS dr,
            COALESCE(SUM(CASE WHEN j.credit_account = coa.id THEN j.amount END), 0) AS cr
       FROM chart_of_accounts coa
       LEFT JOIN journal_entries j ON (j.debit_account = coa.id OR j.credit_account = coa.id) ${where}
      WHERE coa.account_class IN ('asset','liability','equity')
      GROUP BY coa.id, coa.code, coa.name, coa.account_class
      ORDER BY coa.code`,
    params
  );
  const out: BalanceSheet = {
    as_of: asOf,
    assets: [], liabilities: [], equity: [],
    totals: { assets: 0, liabilities: 0, equity: 0 },
  };
  for (const r of rows) {
    const dr = Number(r.dr ?? 0), cr = Number(r.cr ?? 0);
    const bal = r.account_class === "asset" ? dr - cr : cr - dr;
    const row: BalanceSheetRow = { code: r.code, name: r.name, account_class: r.account_class, balance: bal };
    if (r.account_class === "asset") { out.assets.push(row); out.totals.assets += bal; }
    else if (r.account_class === "liability") { out.liabilities.push(row); out.totals.liabilities += bal; }
    else { out.equity.push(row); out.totals.equity += bal; }
  }
  return out;
}
