CREATE OR REPLACE FUNCTION public.compute_late_fee(_principal numeric, _days_past_due integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _days_past_due <= 0 THEN 0
    ELSE _principal * 0.01 * _days_past_due
  END
$function$;

CREATE OR REPLACE FUNCTION public.accrue_late_fees_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.loans
     SET status = 'in_arrears'::loan_status
   WHERE status = 'active' AND due_date IS NOT NULL
     AND due_date < CURRENT_DATE AND outstanding_balance > 0;

  UPDATE public.loans
     SET late_fees = public.compute_late_fee(principal, GREATEST((CURRENT_DATE - due_date)::int, 0))
   WHERE status IN ('in_arrears','active') AND due_date IS NOT NULL
     AND due_date < CURRENT_DATE AND outstanding_balance > 0;
END $function$;