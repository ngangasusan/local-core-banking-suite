
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.loan_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  method loan_method NOT NULL DEFAULT 'reducing_balance',
  min_principal NUMERIC(16,2) NOT NULL DEFAULT 0,
  max_principal NUMERIC(16,2) NOT NULL DEFAULT 1000000,
  interest_rate NUMERIC(6,3) NOT NULL DEFAULT 0.2,
  min_term_months INTEGER NOT NULL DEFAULT 1,
  max_term_months INTEGER NOT NULL DEFAULT 24,
  min_principal_pct NUMERIC(6,3) NOT NULL DEFAULT 0.10,
  daily_interest_rate NUMERIC(8,5) NOT NULL DEFAULT 0.020,
  late_fee_daily_pct NUMERIC(6,3) NOT NULL DEFAULT 0.01,
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  mpesa_fee_threshold NUMERIC(16,2) NOT NULL DEFAULT 10000,
  mpesa_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  early_repayment_days INTEGER NOT NULL DEFAULT 5,
  required_credit_score INTEGER NOT NULL DEFAULT 500,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_products TO authenticated;
GRANT ALL ON public.loan_products TO service_role;

ALTER TABLE public.loan_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Loan products readable by authenticated"
  ON public.loan_products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers can manage loan products"
  ON public.loan_products FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE TRIGGER trg_loan_products_updated_at
  BEFORE UPDATE ON public.loan_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.loan_products(id) ON DELETE SET NULL;

INSERT INTO public.loan_products (code, name, description, method, min_principal, max_principal, interest_rate, min_term_months, max_term_months, daily_interest_rate, late_fee_daily_pct, grace_period_days, mpesa_fee_threshold, required_credit_score)
VALUES
  ('MICRO',    'Micro Loan',     'Small short-term loans up to 10,000 KES', 'flat',              500,    10000,  0.20, 1,  3,  0.020, 0.010, 0,  10000, 500),
  ('SME',      'SME Loan',       'Business loans for small enterprises',    'reducing_balance', 10000,  500000, 0.18, 3,  24, 0.0005,0.010, 3,  10000, 600),
  ('SALARY',   'Salary Advance', 'Short-term salary-backed advance',        'flat',             1000,   100000, 0.15, 1,  3,  0.005, 0.010, 0,  10000, 550),
  ('EMERGENCY','Emergency Loan', 'Fast disbursement emergency loan',        'flat',             500,    50000,  0.25, 1,  6,  0.020, 0.015, 0,  10000, 500);
