-- 1) Late fees column on loans
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS late_fees numeric NOT NULL DEFAULT 0;

-- 2) Aging bucket helper (per loan)
CREATE OR REPLACE FUNCTION public.loan_aging(_loan_id uuid)
RETURNS TABLE(days_past_due integer, bucket text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _due  date;
  _out  numeric;
  _dpd  integer;
BEGIN
  SELECT due_date, outstanding_balance INTO _due, _out
  FROM public.loans WHERE id = _loan_id;
  IF _due IS NULL OR _out <= 0 THEN
    RETURN QUERY SELECT 0, 'current'::text; RETURN;
  END IF;
  _dpd := GREATEST((CURRENT_DATE - _due)::int, 0);
  RETURN QUERY SELECT _dpd, CASE
    WHEN _dpd = 0      THEN 'current'
    WHEN _dpd <= 30    THEN 'par_1_30'
    WHEN _dpd <= 60    THEN 'par_31_60'
    WHEN _dpd <= 90    THEN 'par_61_90'
    ELSE 'par_90_plus'
  END;
END $$;

-- 3) Portfolio-wide PAR summary
CREATE OR REPLACE FUNCTION public.portfolio_par_summary()
RETURNS TABLE(bucket text, loan_count bigint, outstanding numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH a AS (
    SELECT l.id, l.outstanding_balance,
      CASE
        WHEN l.due_date IS NULL OR l.outstanding_balance <= 0 THEN 'current'
        WHEN (CURRENT_DATE - l.due_date) <= 0  THEN 'current'
        WHEN (CURRENT_DATE - l.due_date) <= 30 THEN 'par_1_30'
        WHEN (CURRENT_DATE - l.due_date) <= 60 THEN 'par_31_60'
        WHEN (CURRENT_DATE - l.due_date) <= 90 THEN 'par_61_90'
        ELSE 'par_90_plus'
      END AS bucket
    FROM public.loans l
    WHERE l.status IN ('active','in_arrears','disbursed')
  )
  SELECT bucket, COUNT(*)::bigint, COALESCE(SUM(outstanding_balance),0)::numeric
  FROM a GROUP BY bucket;
$$;

-- 4) Late-fee computation helper (used by total_due + accrual job)
CREATE OR REPLACE FUNCTION public.compute_late_fee(_principal numeric, _days_past_due integer)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _days_past_due <= 0 THEN 0
    ELSE LEAST(_principal * 0.50, _principal * 0.01 * _days_past_due)
  END
$$;

-- 5) Update total-due to include stored late_fees
CREATE OR REPLACE FUNCTION public.compute_loan_total_due(_principal numeric, _days integer)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  interest numeric := public.compute_loan_interest(_principal, _days);
  mpesa    numeric := 0;
BEGIN
  IF _days <= 5 THEN mpesa := public.mpesa_send_charge(_principal); END IF;
  RETURN _principal + interest + mpesa;
END $$;

-- 6) Daily accrual job: mark overdue + bump late_fees to today's value
CREATE OR REPLACE FUNCTION public.accrue_late_fees_daily()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Move active overdue loans to in_arrears
  UPDATE public.loans
     SET status = 'in_arrears'::loan_status
   WHERE status = 'active' AND due_date IS NOT NULL
     AND due_date < CURRENT_DATE AND outstanding_balance > 0;

  -- Recompute late_fees for every past-due loan (idempotent)
  UPDATE public.loans
     SET late_fees = public.compute_late_fee(principal, GREATEST((CURRENT_DATE - due_date)::int, 0))
   WHERE status IN ('in_arrears','active') AND due_date IS NOT NULL
     AND due_date < CURRENT_DATE AND outstanding_balance > 0;
END $$;

-- 7) Make repayment trigger account for late_fees when deciding closure
CREATE OR REPLACE FUNCTION public.apply_repayment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT COALESCE(SUM(amount), 0) INTO _paid_total
      FROM public.loan_repayments WHERE loan_id = NEW.loan_id AND reversed = false;
    _paid_total := _paid_total + NEW.amount;
    _days := COALESCE((CURRENT_DATE - _loan.disbursement_date)::int, 0);
    _total_due := public.compute_loan_total_due(_loan.principal, _days) + COALESCE(_loan.late_fees, 0);

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
END $$;

-- 8) Schedule daily accrual at 01:00 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('accrue-late-fees-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'accrue-late-fees-daily',
  '0 1 * * *',
  $$SELECT public.accrue_late_fees_daily();$$
);

-- 9) Run once now to backfill late_fees on existing overdue loans
SELECT public.accrue_late_fees_daily();