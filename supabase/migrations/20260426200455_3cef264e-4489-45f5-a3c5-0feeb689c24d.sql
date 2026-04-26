
INSERT INTO public.user_roles (user_id, role) VALUES ('9fb90392-5d39-4a62-b231-d1be37919cde', 'super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('9fb90392-5d39-4a62-b231-d1be37919cde', 'admin') ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE UNIQUE INDEX IF NOT EXISTS customers_national_id_unique
  ON public.customers (lower(national_id)) WHERE national_id IS NOT NULL AND national_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
  ON public.customers (phone) WHERE phone IS NOT NULL AND phone <> '';

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT 650;

CREATE OR REPLACE FUNCTION public.recompute_credit_score(_customer_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base int := 650; closed_loans int := 0; arrears_loans int := 0;
  rejected_loans int := 0; on_time_payments int := 0; late_payments int := 0; score int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'closed'),
         COUNT(*) FILTER (WHERE status = 'in_arrears'),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO closed_loans, arrears_loans, rejected_loans
    FROM public.loans WHERE customer_id = _customer_id;

  SELECT COUNT(*) FILTER (WHERE r.paid_at::date <= l.due_date),
         COUNT(*) FILTER (WHERE r.paid_at::date > l.due_date)
    INTO on_time_payments, late_payments
    FROM public.loan_repayments r JOIN public.loans l ON l.id = r.loan_id
    WHERE l.customer_id = _customer_id AND r.reversed = false;

  score := base + (closed_loans*25) + (on_time_payments*8)
                - (arrears_loans*60) - (late_payments*15) - (rejected_loans*10);
  IF score < 300 THEN score := 300; END IF;
  IF score > 850 THEN score := 850; END IF;
  UPDATE public.customers SET credit_score = score WHERE id = _customer_id;
  RETURN score;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_credit_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'loan_repayments' THEN
    SELECT customer_id INTO _cid FROM public.loans WHERE id = COALESCE(NEW.loan_id, OLD.loan_id);
  ELSE
    _cid := COALESCE(NEW.customer_id, OLD.customer_id);
  END IF;
  IF _cid IS NOT NULL THEN PERFORM public.recompute_credit_score(_cid); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS recompute_credit_after_repayment ON public.loan_repayments;
CREATE TRIGGER recompute_credit_after_repayment AFTER INSERT OR UPDATE ON public.loan_repayments
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_credit_score();

DROP TRIGGER IF EXISTS recompute_credit_after_loan ON public.loans;
CREATE TRIGGER recompute_credit_after_loan AFTER UPDATE OF status ON public.loans
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_credit_score();

CREATE OR REPLACE FUNCTION public.enforce_loan_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.status = 'disbursed' AND OLD.status <> 'disbursed' THEN
    NEW.disbursement_date := COALESCE(NEW.disbursement_date, CURRENT_DATE);
    NEW.due_date := NEW.disbursement_date + INTERVAL '30 days';
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
    NEW.status := 'active';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    allowed := CASE
      WHEN OLD.status = 'draft' AND NEW.status IN ('pending','rejected') THEN true
      WHEN OLD.status = 'pending' AND NEW.status IN ('approved','rejected') THEN true
      WHEN OLD.status = 'approved' AND NEW.status IN ('disbursed','active','rejected') THEN true
      WHEN OLD.status = 'disbursed' AND NEW.status IN ('active') THEN true
      WHEN OLD.status = 'active' AND NEW.status IN ('in_arrears','closed') THEN true
      WHEN OLD.status = 'in_arrears' AND NEW.status IN ('active','closed') THEN true
      ELSE false END;
    IF NOT allowed THEN RAISE EXCEPTION 'Invalid loan status transition: % -> %', OLD.status, NEW.status; END IF;
    IF NEW.status = 'approved' AND NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.created_by
       AND NOT public.has_role(auth.uid(),'super_admin') THEN
      RAISE EXCEPTION 'Maker-checker violation: loan creator cannot approve their own loan';
    END IF;
  END IF;
  IF OLD.disbursed_at IS NOT NULL THEN
    IF NEW.principal <> OLD.principal OR NEW.interest_rate <> OLD.interest_rate
       OR NEW.term_months <> OLD.term_months OR NEW.method <> OLD.method
       OR NEW.customer_id <> OLD.customer_id THEN
      RAISE EXCEPTION 'Loan cannot be edited after disbursement';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
