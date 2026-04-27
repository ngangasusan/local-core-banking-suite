-- 1. Unique constraints on national_id and phone (only when present)
CREATE UNIQUE INDEX IF NOT EXISTS customers_national_id_unique ON public.customers (national_id) WHERE national_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON public.customers (phone) WHERE phone IS NOT NULL;

-- 2. Update mpesa_send_charge: skip charge for amounts above 10,000
CREATE OR REPLACE FUNCTION public.mpesa_send_charge(_amount numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN _amount > 10000 THEN 0
    WHEN _amount <= 100   THEN 0
    WHEN _amount <= 500   THEN 7
    WHEN _amount <= 1000  THEN 13
    WHEN _amount <= 1500  THEN 23
    WHEN _amount <= 2500  THEN 33
    WHEN _amount <= 3500  THEN 53
    WHEN _amount <= 5000  THEN 57
    WHEN _amount <= 7500  THEN 78
    WHEN _amount <= 10000 THEN 90
    ELSE 0
  END
$function$;

-- 3. Fix apply_repayment: only close loan when total payable (principal + interest + mpesa) is settled
CREATE OR REPLACE FUNCTION public.apply_repayment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _loan       public.loans%ROWTYPE;
  _days       integer;
  _total_due  numeric;
  _paid_total numeric;
  _new_outstanding numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO _loan FROM public.loans WHERE id = NEW.loan_id;
    _new_outstanding := GREATEST(_loan.outstanding_balance - NEW.amount, 0);
    -- Compute total cumulative repayments (active)
    SELECT COALESCE(SUM(amount), 0) INTO _paid_total
      FROM public.loan_repayments WHERE loan_id = NEW.loan_id AND reversed = false;
    _paid_total := _paid_total + NEW.amount;
    _days := COALESCE((CURRENT_DATE - _loan.disbursement_date)::int, 0);
    _total_due := public.compute_loan_total_due(_loan.principal, _days);

    UPDATE public.loans
       SET outstanding_balance = _new_outstanding,
           status = CASE
             WHEN _paid_total >= _total_due AND status IN ('active','in_arrears')
               THEN 'closed'::loan_status
             ELSE status
           END
     WHERE id = NEW.loan_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.reversed = true AND OLD.reversed = false THEN
    UPDATE public.loans
       SET outstanding_balance = outstanding_balance + NEW.amount,
           status = CASE WHEN status = 'closed' THEN 'active'::loan_status ELSE status END
     WHERE id = NEW.loan_id;
  END IF;
  RETURN NEW;
END $function$;