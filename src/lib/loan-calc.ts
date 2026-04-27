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

/** Accrued interest. Min 10% of principal; daily 20/1000 from day 1; cap 30% after 14 days. */
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

/** Total amount client must pay. M-Pesa send charge added if paid within 5 days. */
export function computeTotalDue(principal: number, days: number): { interest: number; mpesa: number; total: number } {
  const interest = computeInterest(principal, days);
  const mpesa = days <= 5 ? mpesaSendCharge(principal) : 0;
  return { interest, mpesa, total: principal + interest + mpesa };
}

/** Days elapsed since disbursement (for an active loan). */
export function loanDaysElapsed(disbursementDate: string | null): number {
  if (!disbursementDate) return 0;
  return daysBetween(disbursementDate, new Date());
}
