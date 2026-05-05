
-- pgcrypto lives in the "extensions" schema in Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------- 1) PII VAULT ----------
CREATE OR REPLACE FUNCTION public._pii_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT COALESCE(
    current_setting('app.pii_key', true),
    encode(extensions.digest('corebank-pii-v1::' || current_database(), 'sha256'), 'hex')
  );
$$;

CREATE TABLE IF NOT EXISTS public.customer_pii_vault (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  national_id_enc bytea, phone_enc bytea, email_enc bytea, dob_enc bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customer_pii_vault ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Vault read admin" ON public.customer_pii_vault;
CREATE POLICY "Vault read admin" ON public.customer_pii_vault
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'auditor'));

CREATE OR REPLACE FUNCTION public.sync_customer_pii_vault()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _k text := public._pii_key();
BEGIN
  INSERT INTO public.customer_pii_vault(customer_id, national_id_enc, phone_enc, email_enc, dob_enc, updated_at)
  VALUES (
    NEW.id,
    CASE WHEN NEW.national_id IS NOT NULL THEN extensions.pgp_sym_encrypt(NEW.national_id, _k) END,
    CASE WHEN NEW.phone       IS NOT NULL THEN extensions.pgp_sym_encrypt(NEW.phone, _k) END,
    CASE WHEN NEW.email       IS NOT NULL THEN extensions.pgp_sym_encrypt(NEW.email, _k) END,
    CASE WHEN NEW.date_of_birth IS NOT NULL THEN extensions.pgp_sym_encrypt(NEW.date_of_birth::text, _k) END,
    now()
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    national_id_enc = EXCLUDED.national_id_enc,
    phone_enc       = EXCLUDED.phone_enc,
    email_enc       = EXCLUDED.email_enc,
    dob_enc         = EXCLUDED.dob_enc,
    updated_at      = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_pii_vault ON public.customers;
CREATE TRIGGER trg_customer_pii_vault
AFTER INSERT OR UPDATE OF national_id, phone, email, date_of_birth ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_pii_vault();

INSERT INTO public.customer_pii_vault(customer_id, national_id_enc, phone_enc, email_enc, dob_enc)
SELECT c.id,
  CASE WHEN c.national_id IS NOT NULL THEN extensions.pgp_sym_encrypt(c.national_id, public._pii_key()) END,
  CASE WHEN c.phone       IS NOT NULL THEN extensions.pgp_sym_encrypt(c.phone,       public._pii_key()) END,
  CASE WHEN c.email       IS NOT NULL THEN extensions.pgp_sym_encrypt(c.email,       public._pii_key()) END,
  CASE WHEN c.date_of_birth IS NOT NULL THEN extensions.pgp_sym_encrypt(c.date_of_birth::text, public._pii_key()) END
FROM public.customers c
ON CONFLICT (customer_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.decrypt_customer_pii(_customer_id uuid)
RETURNS TABLE(national_id text, phone text, email text, dob date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _k text := public._pii_key();
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'auditor')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT
    extensions.pgp_sym_decrypt(v.national_id_enc, _k),
    extensions.pgp_sym_decrypt(v.phone_enc,       _k),
    extensions.pgp_sym_decrypt(v.email_enc,       _k),
    NULLIF(extensions.pgp_sym_decrypt(v.dob_enc,  _k),'')::date
  FROM public.customer_pii_vault v
  WHERE v.customer_id = _customer_id;
END $$;

-- ---------- 2) AUDIT HASH-CHAIN ----------
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS prev_hash  bytea,
  ADD COLUMN IF NOT EXISTS entry_hash bytea,
  ADD COLUMN IF NOT EXISTS seq        bigserial;

CREATE OR REPLACE FUNCTION public.audit_chain_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE _prev bytea;
BEGIN
  SELECT entry_hash INTO _prev FROM public.audit_log
   WHERE entry_hash IS NOT NULL ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := _prev;
  NEW.entry_hash := extensions.digest(
    COALESCE(encode(_prev,'hex'),'') ||
    COALESCE(NEW.id::text,'') || COALESCE(NEW.user_id::text,'') ||
    COALESCE(NEW.action,'') || COALESCE(NEW.table_name,'') ||
    COALESCE(NEW.record_id::text,'') ||
    COALESCE(NEW.old_data::text,'') || COALESCE(NEW.new_data::text,'') ||
    COALESCE(NEW.created_at::text, now()::text), 'sha256');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_chain ON public.audit_log;
CREATE TRIGGER trg_audit_chain BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_chain_hash();

CREATE OR REPLACE FUNCTION public.verify_audit_chain()
RETURNS TABLE(broken_seq bigint, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _prev bytea := NULL; _expected bytea; r record; _broken bigint := NULL; _total bigint := 0;
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'auditor')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  FOR r IN SELECT * FROM public.audit_log ORDER BY seq ASC LOOP
    _total := _total + 1;
    _expected := extensions.digest(
      COALESCE(encode(_prev,'hex'),'') ||
      COALESCE(r.id::text,'') || COALESCE(r.user_id::text,'') ||
      COALESCE(r.action,'') || COALESCE(r.table_name,'') ||
      COALESCE(r.record_id::text,'') ||
      COALESCE(r.old_data::text,'') || COALESCE(r.new_data::text,'') ||
      COALESCE(r.created_at::text,''), 'sha256');
    IF r.entry_hash IS DISTINCT FROM _expected AND _broken IS NULL THEN
      _broken := r.seq;
    END IF;
    _prev := r.entry_hash;
  END LOOP;
  RETURN QUERY SELECT _broken, _total;
END $$;

-- ---------- 3) KYC MAKER-CHECKER ----------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS kyc_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_verified_by  uuid,
  ADD COLUMN IF NOT EXISTS kyc_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='rejected'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname='kyc_status')) THEN
    ALTER TYPE kyc_status ADD VALUE 'rejected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='verified'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname='kyc_status')) THEN
    ALTER TYPE kyc_status ADD VALUE 'verified';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_customer_kyc(
  _customer_id uuid, _approve boolean, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _submitter uuid; _has_id boolean;
BEGIN
  IF NOT (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Only managers and above can verify KYC';
  END IF;
  SELECT kyc_submitted_by INTO _submitter FROM public.customers WHERE id = _customer_id;
  IF _submitter IS NOT NULL AND _submitter = auth.uid() AND NOT has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION '4-eyes violation: submitter cannot verify their own KYC';
  END IF;
  IF _approve THEN
    SELECT EXISTS(SELECT 1 FROM public.kyc_documents WHERE customer_id=_customer_id AND is_id_document=true) INTO _has_id;
    IF NOT _has_id THEN RAISE EXCEPTION 'Cannot verify: ID document missing'; END IF;
    UPDATE public.customers
       SET kyc_status='verified'::kyc_status, kyc_verified_by=auth.uid(),
           kyc_verified_at=now(), kyc_rejection_reason=NULL
     WHERE id=_customer_id;
  ELSE
    UPDATE public.customers
       SET kyc_status='rejected'::kyc_status, kyc_verified_by=auth.uid(),
           kyc_verified_at=now(), kyc_rejection_reason=COALESCE(_reason,'No reason provided')
     WHERE id=_customer_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_kyc_submitter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kyc_submitted_by IS NULL THEN NEW.kyc_submitted_by := auth.uid(); END IF;
  IF NEW.kyc_submitted_at IS NULL THEN NEW.kyc_submitted_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_kyc_submitter ON public.customers;
CREATE TRIGGER trg_set_kyc_submitter
BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_kyc_submitter();

-- ---------- 4) IFRS 9 PROVISIONING ----------
CREATE TABLE IF NOT EXISTS public.loan_provisions (
  loan_id uuid PRIMARY KEY REFERENCES public.loans(id) ON DELETE CASCADE,
  stage smallint NOT NULL CHECK (stage IN (1,2,3)),
  dpd integer NOT NULL DEFAULT 0,
  exposure numeric NOT NULL DEFAULT 0,
  pd_rate numeric NOT NULL,
  lgd_rate numeric NOT NULL DEFAULT 0.45,
  ecl_amount numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loan_provisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Provisions viewable" ON public.loan_provisions;
CREATE POLICY "Provisions viewable" ON public.loan_provisions
  FOR SELECT TO authenticated USING (has_any_role(auth.uid()));

CREATE OR REPLACE FUNCTION public.recompute_loan_provisions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _stage smallint; _pd numeric; _lgd numeric := 0.45; _dpd int; _ead numeric; _ecl numeric; _cnt int := 0;
BEGIN
  DELETE FROM public.loan_provisions
   WHERE loan_id IN (SELECT id FROM public.loans WHERE status IN ('closed','rejected') OR outstanding_balance <= 0);
  FOR r IN
    SELECT id, outstanding_balance, due_date FROM public.loans
    WHERE status IN ('active','in_arrears','disbursed') AND outstanding_balance > 0
  LOOP
    _dpd := CASE WHEN r.due_date IS NULL THEN 0 ELSE GREATEST((CURRENT_DATE - r.due_date)::int, 0) END;
    IF _dpd <= 30 THEN _stage := 1; _pd := 0.01;
    ELSIF _dpd <= 90 THEN _stage := 2; _pd := 0.10;
    ELSE _stage := 3; _pd := 0.50;
    END IF;
    _ead := r.outstanding_balance;
    _ecl := ROUND(_ead * _pd * _lgd, 2);
    INSERT INTO public.loan_provisions(loan_id, stage, dpd, exposure, pd_rate, lgd_rate, ecl_amount, computed_at)
    VALUES (r.id, _stage, _dpd, _ead, _pd, _lgd, _ecl, now())
    ON CONFLICT (loan_id) DO UPDATE SET
      stage=EXCLUDED.stage, dpd=EXCLUDED.dpd, exposure=EXCLUDED.exposure,
      pd_rate=EXCLUDED.pd_rate, lgd_rate=EXCLUDED.lgd_rate,
      ecl_amount=EXCLUDED.ecl_amount, computed_at=now();
    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $$;

SELECT public.recompute_loan_provisions();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='ifrs9-recompute-daily') THEN
      PERFORM cron.unschedule('ifrs9-recompute-daily');
    END IF;
    PERFORM cron.schedule('ifrs9-recompute-daily','30 1 * * *','SELECT public.recompute_loan_provisions();');
  END IF;
END $$;

-- ---------- 5) MFA GATE ----------
CREATE OR REPLACE FUNCTION public.user_has_mfa(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = _uid AND status = 'verified');
$$;

DROP POLICY IF EXISTS "Privileged reverse repayments" ON public.loan_repayments;
CREATE POLICY "Privileged reverse repayments" ON public.loan_repayments
  FOR UPDATE TO authenticated
  USING (
    (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'))
    AND public.user_has_mfa(auth.uid())
  );

DROP POLICY IF EXISTS "Admin manage COA" ON public.chart_of_accounts;
CREATE POLICY "Admin manage COA" ON public.chart_of_accounts
  FOR ALL TO authenticated
  USING ((has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin')) AND public.user_has_mfa(auth.uid()))
  WITH CHECK ((has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin')) AND public.user_has_mfa(auth.uid()));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

UPDATE public.profiles p SET mfa_required = true
 WHERE EXISTS (
   SELECT 1 FROM public.user_roles r
   WHERE r.user_id = p.id
     AND r.role IN ('super_admin','admin','manager','finance_officer','auditor')
 );
