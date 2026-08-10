// Money math — mirrors src/lib/loan-calc.ts and the legacy Postgres functions
// (compute_loan_interest, compute_late_fee, mpesa_send_charge, compute_loan_total_due).
// All inputs/outputs are plain numbers; callers must ROUND(2) before persisting.

export function mpesaSendCharge(amount: number): number {
  if (amount > 10000) return 0;
  if (amount <= 100) return 0;
  if (amount <= 500) return 7;
  if (amount <= 1000) return 13;
  if (amount <= 1500) return 23;
  if (amount <= 2500) return 33;
  if (amount <= 3500) return 53;
  if (amount <= 5000) return 57;
  if (amount <= 7500) return 78;
  return 90;
}

/** Whole days between two dates (>= 0). */
export function daysBetween(start: Date | string, end: Date | string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const d = Math.floor((e - s) / 86_400_000);
  return d < 0 ? 0 : d;
}

export type InterestRules = {
  tier1_days: number;
  min_principal_pct: number;
  tier2_days: number;
  daily_per_1000: number;
  monthly_days: number;
  monthly_pct: number;
};

export const DEFAULT_INTEREST_RULES: InterestRules = {
  tier1_days: 5,
  min_principal_pct: 0.1,
  tier2_days: 14,
  daily_per_1000: 20,
  monthly_days: 30,
  monthly_pct: 0.3,
};

export function rulesFromProduct(p: any | null | undefined): InterestRules {
  if (!p) return DEFAULT_INTEREST_RULES;
  const n = (v: any, d: number) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
  return {
    tier1_days: n(p.tier1_days, 5),
    min_principal_pct: n(p.min_principal_pct, 0.1),
    tier2_days: n(p.tier2_days, 14),
    daily_per_1000: n(p.daily_per_1000, 20),
    monthly_days: n(p.monthly_days, 30),
    monthly_pct: n(p.monthly_pct, 0.3),
  };
}

/**
 * Tiered interest:
 *  0–5 days      → 10% minimum of principal
 *  6–14 days     → MAX(10% minimum, 20 per 1,000 per day)
 *  15+ days      → 30% of principal per started month
 */
export function computeInterest(principal: number, days: number, rules: InterestRules = DEFAULT_INTEREST_RULES): number {
  if (principal <= 0) return 0;
  const d = Math.max(days, 0);
  const min = principal * rules.min_principal_pct;
  if (d <= rules.tier1_days) return min;
  if (d <= rules.tier2_days) {
    const daily = (principal / 1000) * rules.daily_per_1000;
    return Math.max(min, daily * d);
  }
  const months = Math.max(Math.ceil(d / rules.monthly_days), 1);
  return principal * rules.monthly_pct * months;
}


/** 1% of principal per day past due. */
export function computeLateFee(principal: number, daysPastDue: number): number {
  if (daysPastDue <= 0 || principal <= 0) return 0;
  return principal * 0.01 * daysPastDue;
}

export function daysPastDue(dueDate: string | Date | null, asOf: Date = new Date()): number {
  if (!dueDate) return 0;
  const d = Math.floor((asOf.getTime() - new Date(dueDate).getTime()) / 86_400_000);
  return d > 0 ? d : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ISO date (yyyy-mm-dd) for a Date in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
