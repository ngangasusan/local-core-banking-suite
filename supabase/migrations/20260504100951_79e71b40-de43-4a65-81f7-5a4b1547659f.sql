-- ============================================================
-- SPRINT 1: Money Correctness
-- 1) Foreign keys across the financial graph
-- 2) Repayment waterfall (penalty -> fees -> interest -> principal)
--    with idempotency on (loan_id, reference)
-- 3) Double-entry auto-posting (disbursement + repayment splits)
-- 4) Reconciliation view + variance dashboard support
-- ============================================================

-- ---------- 1. FOREIGN KEYS ----------
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD CONSTRAINT loans_account_fk
  FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT loans_rollover_fk
  FOREIGN KEY (rollover_of) REFERENCES public.loans(id) ON DELETE SET NULL;

ALTER TABLE public.loan_repayments
  ADD CONSTRAINT loan_repayments_loan_fk
  FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE RESTRICT;

ALTER TABLE public.guarantors
  ADD CONSTRAINT guarantors_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_account_fk
  FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT transactions_counterparty_fk
  FOREIGN KEY (counterparty_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE public.kyc_documents
  ADD CONSTRAINT kyc_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.email_queue
  ADD CONSTRAINT email_queue_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD CONSTRAINT email_queue_loan_fk
  FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE SET NULL;

ALTER TABLE public.sms_queue
  ADD CONSTRAINT sms_queue_customer_fk
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD CONSTRAINT sms_queue_loan_fk
  FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE SET NULL;

-- Useful indexes for the new FKs / lookups
CREATE INDEX IF NOT EXISTS idx_loans_customer ON public.loans(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounts_customer ON public.accounts(customer_id);
CREATE INDEX IF NOT EXISTS idx_repayments_loan ON public.loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON public.transactions(account_id);

-- ---------- 2. REPAYMENT WATERFALL + IDEMPOTENCY ----------

-- Add allocation columns so each repayment is a fully-attributed split
ALTER TABLE public.loan_repayments
  ADD COLUMN IF NOT EXISTS allocated_penalty   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_fees      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_interest  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_principal numeric NOT NULL DEFAULT 0;

-- Idempotency: same loan + same external reference cannot post twice
CREATE UNIQUE INDEX IF NOT EXISTS ux_repayments_loan_reference
  ON public.loan_repayments(loan_id, reference);

-- Seed additional income accounts needed for proper GL postings
INSERT INTO public.chart_of_accounts (code, name, account_class) VALUES
  ('4100', 'Penalty Income',     'income'),
  ('4200', 'Fee Income',         'income'),
  ('1050', 'M-Pesa Clearing',    'asset')
ON CONFLICT (code) DO NOTHING;

-- Replace the naive apply_repayment trigger with a true waterfall:
-- penalty -> fees -> interest -> principal, computed at paid_at (not today).
CREATE OR REPLACE FUNCTION public.apply_repayment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _loan        public.loans%ROWTYPE;
  _days        integer;
  _dpd         integer;
  _interest_due numeric;
  _penalty_due  numeric;
  _fees_due     numeric;       -- M-Pesa send-charge while ≤5 days
  _principal_due numeric;
  _paid_so_far_penalty  numeric;
  _paid_so_far_fees     numeric;
  _paid_so_far_interest numeric;
  _paid_so_far_principal numeric;
  _open_penalty numeric; _open_fees numeric;
  _open_interest numeric; _open_principal numeric;
  _amt numeric;
  _alloc_penalty numeric := 0;
  _alloc_fees numeric := 0;
  _alloc_interest numeric := 0;
  _alloc_principal numeric := 0;
  _new_outstanding numeric;
  _total_paid numeric;
  _cash uuid; _loanrec uuid; _intinc uuid; _penaltinc uuid; _feeinc uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO _loan FROM public.loans WHERE id = NEW.loan_id FOR UPDATE;

    -- compute totals as of NEW.paid_at (not CURRENT_DATE)
    _days := GREATEST((NEW.paid_at::date - _loan.disbursement_date)::int, 0);
    _dpd  := CASE WHEN _loan.due_date IS NULL THEN 0
                  ELSE GREATEST((NEW.paid_at::date - _loan.due_date)::int, 0) END;

    _interest_due  := public.compute_loan_interest(_loan.principal, _days);
    _penalty_due   := public.compute_late_fee(_loan.principal, _dpd);
    _fees_due      := CASE WHEN _days <= 5 THEN public.mpesa_send_charge(_loan.principal) ELSE 0 END;
    _principal_due := _loan.principal;

    -- prior allocations on this loan (excluding reversed)
    SELECT COALESCE(SUM(allocated_penalty),0),
           COALESCE(SUM(allocated_fees),0),
           COALESCE(SUM(allocated_interest),0),
           COALESCE(SUM(allocated_principal),0)
      INTO _paid_so_far_penalty, _paid_so_far_fees,
           _paid_so_far_interest, _paid_so_far_principal
      FROM public.loan_repayments
     WHERE loan_id = NEW.loan_id AND reversed = false AND id <> NEW.id;

    _open_penalty   := GREATEST(_penalty_due  - _paid_so_far_penalty, 0);
    _open_fees      := GREATEST(_fees_due     - _paid_so_far_fees, 0);
    _open_interest  := GREATEST(_interest_due - _paid_so_far_interest, 0);
    _open_principal := GREATEST(_principal_due - _paid_so_far_principal, 0);

    _amt := NEW.amount;

    -- Waterfall
    _alloc_penalty   := LEAST(_amt, _open_penalty);   _amt := _amt - _alloc_penalty;
    _alloc_fees      := LEAST(_amt, _open_fees);      _amt := _amt - _alloc_fees;
    _alloc_interest  := LEAST(_amt, _open_interest);  _amt := _amt - _alloc_interest;
    _alloc_principal := LEAST(_amt, _open_principal); _amt := _amt - _alloc_principal;

    IF _amt > 0.005 THEN
      RAISE EXCEPTION 'Repayment % exceeds total payable on loan %', NEW.amount, _loan.loan_number;
    END IF;

    -- Persist allocations on this row
    NEW.allocated_penalty   := ROUND(_alloc_penalty, 2);
    NEW.allocated_fees      := ROUND(_alloc_fees, 2);
    NEW.allocated_interest  := ROUND(_alloc_interest, 2);
    NEW.allocated_principal := ROUND(_alloc_principal, 2);

    -- Update loan: outstanding tracks principal only
    _new_outstanding := GREATEST(_loan.outstanding_balance - _alloc_principal, 0);

    _total_paid := _paid_so_far_penalty + _paid_so_far_fees + _paid_so_far_interest + _paid_so_far_principal + NEW.amount;

    UPDATE public.loans
       SET outstanding_balance = _new_outstanding,
           late_fees = GREATEST(_penalty_due - (_paid_so_far_penalty + _alloc_penalty), 0),
           status = CASE
             WHEN _total_paid >= (_penalty_due + _fees_due + _interest_due + _principal_due) - 0.01
                  AND status IN ('active','in_arrears') THEN 'closed'::loan_status
             ELSE status
           END
     WHERE id = NEW.loan_id;

    -- ---------- DOUBLE-ENTRY POSTING ----------
    -- Dr Cash for the full receipt; credit the matching income/receivable accounts.
    SELECT id INTO _cash      FROM public.chart_of_accounts WHERE code = '1000';
    SELECT id INTO _loanrec   FROM public.chart_of_accounts WHERE code = '1100';
    SELECT id INTO _intinc    FROM public.chart_of_accounts WHERE code = '4000';
    SELECT id INTO _penaltinc FROM public.chart_of_accounts WHERE code = '4100';
    SELECT id INTO _feeinc    FROM public.chart_of_accounts WHERE code = '4200';

    IF _alloc_principal > 0 AND _cash IS NOT NULL AND _loanrec IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (NEW.paid_at::date, NEW.reference || '-P', 'Repayment principal ' || _loan.loan_number,
              _cash, _loanrec, _alloc_principal, 'loan_repayments', NEW.id, NEW.posted_by);
    END IF;
    IF _alloc_interest > 0 AND _cash IS NOT NULL AND _intinc IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (NEW.paid_at::date, NEW.reference || '-I', 'Repayment interest ' || _loan.loan_number,
              _cash, _intinc, _alloc_interest, 'loan_repayments', NEW.id, NEW.posted_by);
    END IF;
    IF _alloc_penalty > 0 AND _cash IS NOT NULL AND _penaltinc IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (NEW.paid_at::date, NEW.reference || '-L', 'Repayment penalty ' || _loan.loan_number,
              _cash, _penaltinc, _alloc_penalty, 'loan_repayments', NEW.id, NEW.posted_by);
    END IF;
    IF _alloc_fees > 0 AND _cash IS NOT NULL AND _feeinc IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (NEW.paid_at::date, NEW.reference || '-F', 'Repayment fees ' || _loan.loan_number,
              _cash, _feeinc, _alloc_fees, 'loan_repayments', NEW.id, NEW.posted_by);
    END IF;

  ELSIF TG_OP = 'UPDATE' AND NEW.reversed = true AND OLD.reversed = false THEN
    -- Reverse principal back to outstanding; reopen if was closed
    UPDATE public.loans
       SET outstanding_balance = outstanding_balance + OLD.allocated_principal,
           status = CASE WHEN status = 'closed' THEN 'active'::loan_status ELSE status END
     WHERE id = NEW.loan_id;

    -- Counter-entries (swap debit/credit) for each split
    SELECT id INTO _cash      FROM public.chart_of_accounts WHERE code = '1000';
    SELECT id INTO _loanrec   FROM public.chart_of_accounts WHERE code = '1100';
    SELECT id INTO _intinc    FROM public.chart_of_accounts WHERE code = '4000';
    SELECT id INTO _penaltinc FROM public.chart_of_accounts WHERE code = '4100';
    SELECT id INTO _feeinc    FROM public.chart_of_accounts WHERE code = '4200';

    IF OLD.allocated_principal > 0 THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (CURRENT_DATE, NEW.reference || '-P-REV', 'Reversal principal', _loanrec, _cash, OLD.allocated_principal, 'loan_repayments', NEW.id, NEW.reversed_by);
    END IF;
    IF OLD.allocated_interest > 0 THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (CURRENT_DATE, NEW.reference || '-I-REV', 'Reversal interest', _intinc, _cash, OLD.allocated_interest, 'loan_repayments', NEW.id, NEW.reversed_by);
    END IF;
    IF OLD.allocated_penalty > 0 THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (CURRENT_DATE, NEW.reference || '-L-REV', 'Reversal penalty', _penaltinc, _cash, OLD.allocated_penalty, 'loan_repayments', NEW.id, NEW.reversed_by);
    END IF;
    IF OLD.allocated_fees > 0 THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (CURRENT_DATE, NEW.reference || '-F-REV', 'Reversal fees', _feeinc, _cash, OLD.allocated_fees, 'loan_repayments', NEW.id, NEW.reversed_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- BEFORE INSERT so the function can mutate NEW.allocated_* before the row is written
DROP TRIGGER IF EXISTS trg_apply_repayment_ins ON public.loan_repayments;
DROP TRIGGER IF EXISTS trg_apply_repayment_upd ON public.loan_repayments;
CREATE TRIGGER trg_apply_repayment_ins
  BEFORE INSERT ON public.loan_repayments
  FOR EACH ROW EXECUTE FUNCTION public.apply_repayment();
CREATE TRIGGER trg_apply_repayment_upd
  AFTER UPDATE ON public.loan_repayments
  FOR EACH ROW EXECUTE FUNCTION public.apply_repayment();

-- ---------- 3. DISBURSEMENT AUTO-POSTING ----------
-- When a loan flips into 'active' (i.e., disbursed), auto-post Dr Loans Receivable / Cr Cash
CREATE OR REPLACE FUNCTION public.post_disbursement_je()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cash uuid; _loanrec uuid;
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS DISTINCT FROM 'active')
     AND NEW.disbursed_at IS NOT NULL THEN
    SELECT id INTO _cash    FROM public.chart_of_accounts WHERE code = '1000';
    SELECT id INTO _loanrec FROM public.chart_of_accounts WHERE code = '1100';
    IF _cash IS NOT NULL AND _loanrec IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
      VALUES (COALESCE(NEW.disbursement_date, CURRENT_DATE),
              'DISB-' || NEW.loan_number,
              'Disbursement ' || NEW.loan_number,
              _loanrec, _cash, NEW.principal, 'loans', NEW.id, NEW.created_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_post_disbursement_je ON public.loans;
CREATE TRIGGER trg_post_disbursement_je
  AFTER UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.post_disbursement_je();

-- ---------- 4. JOURNAL ENTRY BALANCE GUARD ----------
-- Prevent unbalanced postings: same debit/credit, positive amount, both accounts present.
CREATE OR REPLACE FUNCTION public.je_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.debit_account IS NULL OR NEW.credit_account IS NULL THEN
    RAISE EXCEPTION 'Journal entry requires both debit and credit accounts';
  END IF;
  IF NEW.debit_account = NEW.credit_account THEN
    RAISE EXCEPTION 'Journal entry debit and credit cannot be the same account';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Journal entry amount must be positive';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_je_validate ON public.journal_entries;
CREATE TRIGGER trg_je_validate
  BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.je_validate();

-- ---------- 5. RECONCILIATION VIEW ----------
-- Per-day variance between cash receipts (transactions) and repayments + GL cash debits.
CREATE OR REPLACE VIEW public.daily_recon AS
WITH txn_cash AS (
  SELECT created_at::date AS d, COALESCE(SUM(amount),0) AS amt
  FROM public.transactions
  WHERE txn_type = 'loan_repayment' AND status = 'completed'
  GROUP BY 1
),
rep_cash AS (
  SELECT paid_at::date AS d, COALESCE(SUM(amount),0) AS amt
  FROM public.loan_repayments
  WHERE reversed = false
  GROUP BY 1
),
gl_cash AS (
  SELECT je.entry_date AS d, COALESCE(SUM(je.amount),0) AS amt
  FROM public.journal_entries je
  JOIN public.chart_of_accounts coa ON coa.id = je.debit_account
  WHERE coa.code = '1000' AND je.source_table = 'loan_repayments'
  GROUP BY 1
)
SELECT
  COALESCE(t.d, r.d, g.d) AS day,
  COALESCE(t.amt,0) AS transactions_cash,
  COALESCE(r.amt,0) AS repayments_cash,
  COALESCE(g.amt,0) AS gl_cash,
  COALESCE(r.amt,0) - COALESCE(t.amt,0) AS variance_repayment_vs_txn,
  COALESCE(r.amt,0) - COALESCE(g.amt,0) AS variance_repayment_vs_gl
FROM txn_cash t
FULL OUTER JOIN rep_cash r ON r.d = t.d
FULL OUTER JOIN gl_cash  g ON g.d = COALESCE(t.d, r.d)
ORDER BY day DESC;

GRANT SELECT ON public.daily_recon TO authenticated;