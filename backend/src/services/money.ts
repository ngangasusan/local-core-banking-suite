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

/** Accrued interest: min 10% of principal, daily 20/1000 from day 1, cap 30% after 14 days. */
export function computeInterest(principal: number, days: number): number {
  if (principal <= 0) return 0;
  const min = principal * 0.10;
  const cap = principal * 0.30;
  if (days > 14) return cap;
  const daily = (principal / 1000) * 20;
  let accrued = daily * Math.max(days, 1);
  if (accrued < min) accrued = min;
  if (accrued > cap) accrued = cap;
  return accrued;
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
