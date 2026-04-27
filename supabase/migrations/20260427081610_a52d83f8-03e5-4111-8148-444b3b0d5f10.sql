-- Loan calculation rule columns
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS projected_payment_date date,
  ADD COLUMN IF NOT EXISTS mpesa_charge numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rollover_of uuid REFERENCES public.loans(id);

-- M-Pesa send-money tariff (Safaricom, KES). Returns charge for sending `amount` from M-Pesa to M-Pesa.
CREATE OR REPLACE FUNCTION public.mpesa_send_charge(_amount numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _amount <= 49    THEN 0
    WHEN _amount <= 100   THEN 0
    WHEN _amount <= 500   THEN 7
    WHEN _amount <= 1000  THEN 13
    WHEN _amount <= 1500  THEN 23
    WHEN _amount <= 2500  THEN 33
    WHEN _amount <= 3500  THEN 53
    WHEN _amount <= 5000  THEN 57
    WHEN _amount <= 7500  THEN 78
    WHEN _amount <= 10000 THEN 90
    WHEN _amount <= 15000 THEN 100
    WHEN _amount <= 20000 THEN 105
    WHEN _amount <= 35000 THEN 108
    WHEN _amount <= 50000 THEN 108
    WHEN _amount <= 250000 THEN 108
    ELSE 108
  END
$$;

-- Compute accrued interest given principal and days elapsed.
-- Rules: min 10% of principal; daily = (principal/1000)*20 from day 1; cap = 30% of principal after 14 days.
CREATE OR REPLACE FUNCTION public.compute_loan_interest(_principal numeric, _days integer)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  min_interest numeric := _principal * 0.10;
  cap          numeric := _principal * 0.30;
  daily        numeric := (_principal / 1000.0) * 20.0;
  accrued      numeric;
BEGIN
  IF _days < 0 THEN _days := 0; END IF;
  IF _days > 14 THEN
    RETURN cap;
  END IF;
  accrued := daily * GREATEST(_days, 1);
  IF accrued < min_interest THEN accrued := min_interest; END IF;
  IF accrued > cap THEN accrued := cap; END IF;
  RETURN accrued;
END $$;

-- Compute total payable (principal + interest + mpesa charge if paid in <=5 days).
CREATE OR REPLACE FUNCTION public.compute_loan_total_due(_principal numeric, _days integer)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  interest numeric := public.compute_loan_interest(_principal, _days);
  mpesa    numeric := 0;
BEGIN
  IF _days <= 5 THEN
    mpesa := public.mpesa_send_charge(_principal);
  END IF;
  RETURN _principal + interest + mpesa;
END $$;

-- Loan qualification: combines income, account balance, credit score, active loans.
CREATE OR REPLACE FUNCTION public.qualified_loan_amount(_customer_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  income     numeric := 0;
  bal        numeric := 0;
  score      integer := 650;
  outstanding numeric := 0;
  base       numeric;
  factor     numeric;
  qualified  numeric;
BEGIN
  SELECT COALESCE(monthly_income, 0), COALESCE(credit_score, 650)
    INTO income, score FROM public.customers WHERE id = _customer_id;
  SELECT COALESCE(SUM(balance), 0) INTO bal FROM public.accounts WHERE customer_id = _customer_id AND status = 'active';
  SELECT COALESCE(SUM(outstanding_balance), 0) INTO outstanding
    FROM public.loans WHERE customer_id = _customer_id AND status IN ('active', 'in_arrears', 'disbursed');

  base := GREATEST(income * 0.5, bal * 2);
  -- Credit score factor: linear from 0.3 @ 300 to 1.5 @ 850
  factor := 0.3 + ((score - 300)::numeric / 550.0) * 1.2;
  IF factor < 0.3 THEN factor := 0.3; END IF;
  IF factor > 1.5 THEN factor := 1.5; END IF;

  qualified := base * factor - outstanding;
  IF qualified < 0 THEN qualified := 0; END IF;
  RETURN ROUND(qualified, 2);
END $$;

-- Update repayment trigger to also store mpesa_charge on first early repayment, no schema change to repayments needed.
-- (Optional: nothing else changes.)