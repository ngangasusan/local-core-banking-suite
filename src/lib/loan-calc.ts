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
): { interest: number; mpesa: number; lateFee: number; total: number } {
  const interest = computeInterest(principal, days);
  const mpesa = days <= 5 ? mpesaSendCharge(principal) : 0;
  const lateFee = computeLateFee(principal, daysPastDue(dueDate));
  return { interest, mpesa, lateFee, total: principal + interest + mpesa + lateFee };
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
