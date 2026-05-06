
-- ============ Chart of accounts: bad debt expense ============
INSERT INTO public.chart_of_accounts(code, name, account_class, is_active)
VALUES ('5100','Bad Debt Expense','expense', true)
ON CONFLICT (code) DO NOTHING;

-- ============ Enums ============
DO $$ BEGIN
  CREATE TYPE public.collection_channel AS ENUM ('call','sms','email','visit','letter','field');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.collection_outcome AS ENUM ('reached','no_answer','wrong_number','promise','refused','partial_payment','dispute','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ptp_status AS ENUM ('open','kept','broken','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.workflow_status AS ENUM ('pending','approved','rejected','applied','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.guarantor_followup_status AS ENUM ('pending','contacted','committed','escalated','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ collection_actions ============
CREATE TABLE IF NOT EXISTS public.collection_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id     uuid NOT NULL,
  customer_id uuid NOT NULL,
  channel     public.collection_channel NOT NULL,
  outcome     public.collection_outcome NOT NULL,
  notes       text,
  next_action_at date,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coll_actions_loan ON public.collection_actions(loan_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_coll_actions_cust ON public.collection_actions(customer_id, performed_at DESC);
ALTER TABLE public.collection_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view collection actions" ON public.collection_actions
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff log collection actions" ON public.collection_actions
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
    OR public.has_role(auth.uid(),'finance_officer') OR public.has_role(auth.uid(),'teller')
  );

-- ============ promises_to_pay ============
CREATE TABLE IF NOT EXISTS public.promises_to_pay (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id      uuid NOT NULL,
  customer_id  uuid NOT NULL,
  promised_amount numeric NOT NULL CHECK (promised_amount > 0),
  promised_date   date NOT NULL,
  status       public.ptp_status NOT NULL DEFAULT 'open',
  notes        text,
  recorded_by  uuid,
  resolved_at  timestamptz,
  resolved_amount numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ptp_loan ON public.promises_to_pay(loan_id, status, promised_date);
CREATE TRIGGER trg_ptp_updated BEFORE UPDATE ON public.promises_to_pay
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.promises_to_pay ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view ptp" ON public.promises_to_pay
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff create ptp" ON public.promises_to_pay
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
    OR public.has_role(auth.uid(),'finance_officer') OR public.has_role(auth.uid(),'teller')
  );
CREATE POLICY "Staff update ptp" ON public.promises_to_pay
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
  );

-- Sweep: mark broken promises (date passed and not enough collected since recorded_at)
CREATE OR REPLACE FUNCTION public.sweep_broken_promises()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; _paid numeric; _cnt int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.promises_to_pay
     WHERE status = 'open' AND promised_date < CURRENT_DATE
  LOOP
    SELECT COALESCE(SUM(amount),0) INTO _paid
      FROM public.loan_repayments
     WHERE loan_id = r.loan_id AND reversed = false
       AND paid_at >= r.created_at AND paid_at::date <= CURRENT_DATE;
    IF _paid >= r.promised_amount THEN
      UPDATE public.promises_to_pay
         SET status='kept', resolved_at=now(), resolved_amount=_paid
       WHERE id = r.id;
    ELSE
      UPDATE public.promises_to_pay
         SET status='broken', resolved_at=now(), resolved_amount=_paid
       WHERE id = r.id;
    END IF;
    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $$;

-- ============ loan_restructures (maker-checker) ============
CREATE TABLE IF NOT EXISTS public.loan_restructures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         uuid NOT NULL,
  reason          text NOT NULL,
  new_due_date    date NOT NULL,
  new_term_months integer,
  new_interest_rate numeric,
  status          public.workflow_status NOT NULL DEFAULT 'pending',
  requested_by    uuid,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid,
  approved_at     timestamptz,
  rejection_reason text,
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_restruct_loan ON public.loan_restructures(loan_id, status);
CREATE TRIGGER trg_restruct_updated BEFORE UPDATE ON public.loan_restructures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.loan_restructures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view restructures" ON public.loan_restructures
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Officers request restructures" ON public.loan_restructures
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
  );
CREATE POLICY "Managers approve restructures" ON public.loan_restructures
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager')
  );

CREATE OR REPLACE FUNCTION public.approve_loan_restructure(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.loan_restructures%ROWTYPE;
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Only managers and above can approve restructures';
  END IF;
  SELECT * INTO r FROM public.loan_restructures WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Restructure already %', r.status; END IF;
  IF r.requested_by = auth.uid() AND NOT has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION '4-eyes violation: requester cannot approve';
  END IF;
  IF _approve THEN
    UPDATE public.loans
       SET due_date = r.new_due_date,
           term_months = COALESCE(r.new_term_months, term_months),
           interest_rate = COALESCE(r.new_interest_rate, interest_rate),
           status = CASE WHEN status = 'in_arrears' THEN 'active'::loan_status ELSE status END,
           late_fees = 0
     WHERE id = r.loan_id;
    UPDATE public.loan_restructures
       SET status='applied', approved_by=auth.uid(), approved_at=now(), applied_at=now()
     WHERE id = _id;
  ELSE
    UPDATE public.loan_restructures
       SET status='rejected', approved_by=auth.uid(), approved_at=now(), rejection_reason=COALESCE(_reason,'Rejected')
     WHERE id = _id;
  END IF;
END $$;

-- ============ loan_writeoffs (maker-checker, posts JE on approval) ============
CREATE TABLE IF NOT EXISTS public.loan_writeoffs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id      uuid NOT NULL,
  amount       numeric NOT NULL CHECK (amount > 0),
  reason       text NOT NULL,
  status       public.workflow_status NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by  uuid,
  approved_at  timestamptz,
  rejection_reason text,
  applied_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wo_loan ON public.loan_writeoffs(loan_id, status);
CREATE TRIGGER trg_wo_updated BEFORE UPDATE ON public.loan_writeoffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.loan_writeoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view writeoffs" ON public.loan_writeoffs
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Officers request writeoffs" ON public.loan_writeoffs
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
  );
CREATE POLICY "Admin approves writeoffs" ON public.loan_writeoffs
  FOR UPDATE TO authenticated USING (
    (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin'))
    AND user_has_mfa(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.approve_loan_writeoff(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.loan_writeoffs%ROWTYPE; _loan public.loans%ROWTYPE;
        _badexp uuid; _loanrec uuid;
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only admins can approve write-offs';
  END IF;
  IF NOT user_has_mfa(auth.uid()) THEN
    RAISE EXCEPTION 'MFA required to approve write-offs';
  END IF;
  SELECT * INTO r FROM public.loan_writeoffs WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Write-off already %', r.status; END IF;
  IF r.requested_by = auth.uid() AND NOT has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION '4-eyes violation: requester cannot approve';
  END IF;

  IF _approve THEN
    SELECT * INTO _loan FROM public.loans WHERE id = r.loan_id FOR UPDATE;
    IF r.amount > _loan.outstanding_balance + 0.01 THEN
      RAISE EXCEPTION 'Write-off amount exceeds outstanding balance';
    END IF;

    SELECT id INTO _badexp  FROM public.chart_of_accounts WHERE code = '5100';
    SELECT id INTO _loanrec FROM public.chart_of_accounts WHERE code = '1100';
    IF _badexp IS NULL OR _loanrec IS NULL THEN
      RAISE EXCEPTION 'Chart of accounts missing 5100/1100';
    END IF;
    INSERT INTO public.journal_entries(entry_date, reference, description, debit_account, credit_account, amount, source_table, source_id, created_by)
    VALUES (CURRENT_DATE, 'WO-' || _loan.loan_number,
            'Write-off ' || _loan.loan_number || ' (' || COALESCE(r.reason,'') || ')',
            _badexp, _loanrec, r.amount, 'loan_writeoffs', r.id, auth.uid());

    UPDATE public.loans
       SET outstanding_balance = GREATEST(outstanding_balance - r.amount, 0),
           status = CASE WHEN outstanding_balance - r.amount <= 0.01 THEN 'closed'::loan_status ELSE status END
     WHERE id = r.loan_id;

    UPDATE public.loan_writeoffs
       SET status='applied', approved_by=auth.uid(), approved_at=now(), applied_at=now()
     WHERE id = _id;
  ELSE
    UPDATE public.loan_writeoffs
       SET status='rejected', approved_by=auth.uid(), approved_at=now(), rejection_reason=COALESCE(_reason,'Rejected')
     WHERE id = _id;
  END IF;
END $$;

-- ============ guarantor_followups ============
CREATE TABLE IF NOT EXISTS public.guarantor_followups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       uuid NOT NULL,
  guarantor_id  uuid NOT NULL,
  status        public.guarantor_followup_status NOT NULL DEFAULT 'pending',
  notes         text,
  next_action_at date,
  contacted_at  timestamptz,
  performed_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gf_loan ON public.guarantor_followups(loan_id);
CREATE TRIGGER trg_gf_updated BEFORE UPDATE ON public.guarantor_followups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.guarantor_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view guarantor followups" ON public.guarantor_followups
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff create guarantor followups" ON public.guarantor_followups
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
    OR public.has_role(auth.uid(),'finance_officer')
  );
CREATE POLICY "Staff update guarantor followups" ON public.guarantor_followups
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer')
  );

-- ============ Collections worklist view ============
CREATE OR REPLACE VIEW public.collections_worklist
WITH (security_invoker = true)
AS
SELECT
  l.id              AS loan_id,
  l.loan_number,
  l.customer_id,
  c.full_name       AS customer_name,
  c.phone           AS customer_phone,
  l.outstanding_balance,
  l.due_date,
  l.status,
  GREATEST((CURRENT_DATE - l.due_date)::int, 0) AS dpd,
  CASE
    WHEN l.due_date IS NULL THEN 'current'
    WHEN (CURRENT_DATE - l.due_date) <= 0  THEN 'current'
    WHEN (CURRENT_DATE - l.due_date) <= 30 THEN 'par_1_30'
    WHEN (CURRENT_DATE - l.due_date) <= 60 THEN 'par_31_60'
    WHEN (CURRENT_DATE - l.due_date) <= 90 THEN 'par_61_90'
    ELSE 'par_90_plus'
  END AS bucket,
  (SELECT MAX(performed_at) FROM public.collection_actions a WHERE a.loan_id = l.id) AS last_contact_at,
  (SELECT promised_date FROM public.promises_to_pay p
     WHERE p.loan_id = l.id AND p.status = 'open' ORDER BY promised_date ASC LIMIT 1) AS open_ptp_date,
  (SELECT promised_amount FROM public.promises_to_pay p
     WHERE p.loan_id = l.id AND p.status = 'open' ORDER BY promised_date ASC LIMIT 1) AS open_ptp_amount
FROM public.loans l
JOIN public.customers c ON c.id = l.customer_id
WHERE l.status IN ('active','in_arrears','disbursed') AND l.outstanding_balance > 0;

GRANT SELECT ON public.collections_worklist TO authenticated;
