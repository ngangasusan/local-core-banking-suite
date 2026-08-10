// Mirrors SQL: public.compute_loan_interest / compute_loan_total_due / mpesa_send_charge.
// Keep these in sync.

export function mpesaSendCharge(amount: number): number {
  // No M-Pesa transaction fee added to loans above 10,000.
  if (amount > 10000) return 0;
  if (amount <= 100) return 0;
  if (amount <= 500) return 7;
  if (amount <= 1000) return 13;
  if (amount <= 1500) return 23;
  if (amount <= 2500) return 33;
  if (amount <= 3500) return 53;
  if (amount <= 5000) return 57;
  if (amount <= 7500) return 78;
  return 90; // up to 10,000
}

/** Days between two dates (calendar-day rounded, min 0). */
export function daysBetween(start: Date | string, end: Date | string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const diff = Math.floor((e - s) / 86_400_000);
  return diff < 0 ? 0 : diff;
}

/**
 * Configurable tiered interest rules.
 * Defaults mirror the house standard:
 *  - Tier 1 (0–5 days): flat minimum, 10% of principal
 *  - Tier 2 (6–14 days): MAX(10% minimum, 20 per 1,000 per day)
 *  - Tier 3 (15–30 days): 30% of principal, charged per month (each further 30 days adds 30%)
 */
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

/** Build rules from a loan_products row (falls back to defaults for missing columns). */
export function rulesFromProduct(p: any | null | undefined): InterestRules {
  if (!p) return DEFAULT_INTEREST_RULES;
  const n = (v: any, d: number) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
  return {
    tier1_days: n(p.tier1_days, DEFAULT_INTEREST_RULES.tier1_days),
    min_principal_pct: n(p.min_principal_pct, DEFAULT_INTEREST_RULES.min_principal_pct),
    tier2_days: n(p.tier2_days, DEFAULT_INTEREST_RULES.tier2_days),
    daily_per_1000: n(p.daily_per_1000, DEFAULT_INTEREST_RULES.daily_per_1000),
    monthly_days: n(p.monthly_days, DEFAULT_INTEREST_RULES.monthly_days),
    monthly_pct: n(p.monthly_pct, DEFAULT_INTEREST_RULES.monthly_pct),
  };
}

export type InterestBreakdown = {
  interest: number;
  tier: 1 | 2 | 3;
  tierLabel: string;
  months: number;
  steps: string[];
};

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Full interest breakdown with human-readable calculation steps. */
export function computeInterestBreakdown(
  principal: number,
  days: number,
  rules: InterestRules = DEFAULT_INTEREST_RULES,
): InterestBreakdown {
  if (principal <= 0) return { interest: 0, tier: 1, tierLabel: "—", months: 0, steps: ["No principal."] };
  const d = Math.max(days, 0);
  const min = principal * rules.min_principal_pct;
  const pctLabel = (v: number) => `${(v * 100).toFixed(v * 100 % 1 === 0 ? 0 : 2)}%`;

  if (d <= rules.tier1_days) {
    return {
      interest: min,
      tier: 1,
      tierLabel: `0–${rules.tier1_days} days`,
      months: 0,
      steps: [
        `Days elapsed: ${d} → tier 1 (0–${rules.tier1_days} days)`,
        `Minimum interest: ${money(principal)} × ${pctLabel(rules.min_principal_pct)} = ${money(min)}`,
        `Interest charged: ${money(min)}`,
      ],
    };
  }

  if (d <= rules.tier2_days) {
    const daily = (principal / 1000) * rules.daily_per_1000;
    const accrued = daily * d;
    const interest = Math.max(min, accrued);
    return {
      interest,
      tier: 2,
      tierLabel: `${rules.tier1_days + 1}–${rules.tier2_days} days`,
      months: 0,
      steps: [
        `Days elapsed: ${d} → tier 2 (${rules.tier1_days + 1}–${rules.tier2_days} days)`,
        `Daily charge: (${money(principal)} / 1,000) × ${rules.daily_per_1000} = ${money(daily)} per day`,
        `Daily interest: ${money(daily)} × ${d} = ${money(accrued)}`,
        `Minimum interest: ${money(principal)} × ${pctLabel(rules.min_principal_pct)} = ${money(min)}`,
        `Interest charged: MAX(${money(min)}, ${money(accrued)}) = ${money(interest)}`,
      ],
    };
  }

  const months = Math.max(Math.ceil(d / rules.monthly_days), 1);
  const interest = principal * rules.monthly_pct * months;
  return {
    interest,
    tier: 3,
    tierLabel: `${rules.tier2_days + 1}–${rules.monthly_days} days (monthly)`,
    months,
    steps: [
      `Days elapsed: ${d} → tier 3 (${rules.tier2_days + 1}+ days, charged monthly)`,
      `Months started: CEIL(${d} / ${rules.monthly_days}) = ${months}`,
      `Interest: ${money(principal)} × ${pctLabel(rules.monthly_pct)} × ${months} = ${money(interest)}`,
    ],
  };
}

/** Accrued interest under the tiered rules. */
export function computeInterest(principal: number, days: number, rules: InterestRules = DEFAULT_INTEREST_RULES): number {
  return computeInterestBreakdown(principal, days, rules).interest;
}


/** Late penalty fee: 1% of principal per day past due (no cap). */
export function computeLateFee(principal: number, daysPastDue: number): number {
  if (daysPastDue <= 0 || principal <= 0) return 0;
  return principal * 0.01 * daysPastDue;
}

/** Days past due_date (0 if not yet due or no due date). */
export function daysPastDue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate).getTime();
  const today = Date.now();
  const diff = Math.floor((today - due) / 86_400_000);
  return diff > 0 ? diff : 0;
}

/** Total amount client must pay. M-Pesa send charge added if paid within 5 days; late fee added if past due. */
export function computeTotalDue(
  principal: number,
  days: number,
  dueDate: string | null = null,
  rules: InterestRules = DEFAULT_INTEREST_RULES,
): { interest: number; mpesa: number; lateFee: number; total: number; breakdown: InterestBreakdown } {
  const breakdown = computeInterestBreakdown(principal, days, rules);
  const interest = breakdown.interest;
  const mpesa = days <= 5 ? mpesaSendCharge(principal) : 0;
  const lateFee = computeLateFee(principal, daysPastDue(dueDate));
  return { interest, mpesa, lateFee, total: principal + interest + mpesa + lateFee, breakdown };
}


/** Aging bucket label for an outstanding loan. */
export function agingBucket(dueDate: string | null, outstanding: number): "current" | "par_1_30" | "par_31_60" | "par_61_90" | "par_90_plus" {
  if (!dueDate || outstanding <= 0) return "current";
  const dpd = daysPastDue(dueDate);
  if (dpd === 0) return "current";
  if (dpd <= 30) return "par_1_30";
  if (dpd <= 60) return "par_31_60";
  if (dpd <= 90) return "par_61_90";
  return "par_90_plus";
}

/** Days elapsed since disbursement (for an active loan). */
export function loanDaysElapsed(disbursementDate: string | null): number {
  if (!disbursementDate) return 0;
  return daysBetween(disbursementDate, new Date());
}

/** Local-date ISO string (YYYY-MM-DD). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Add whole days to a date (returns a new Date). */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}
