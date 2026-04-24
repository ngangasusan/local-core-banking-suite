
-- New columns
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS disbursement_date date,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at timestamptz;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email text;

-- ========== PERMISSIONS ==========
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, permission_id)
);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permissions viewable by authenticated" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin manages permissions" ON public.permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Role permissions viewable" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admin manages role_permissions" ON public.role_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id AND p.code = _permission
  )
$$;

INSERT INTO public.permissions (code, description, category) VALUES
  ('users.manage','Create/edit/deactivate users and assign roles','users'),
  ('permissions.manage','Edit role permissions','users'),
  ('customers.create','Create customers','customers'),
  ('customers.edit','Edit customers','customers'),
  ('customers.delete','Delete customers','customers'),
  ('loans.create','Originate loan applications','loans'),
  ('loans.approve','Approve or reject loans','loans'),
  ('loans.disburse','Disburse approved loans','loans'),
  ('transactions.post','Post deposits/withdrawals/transfers','transactions'),
  ('transactions.reverse','Reverse transactions','transactions'),
  ('repayments.post','Post loan repayments','repayments'),
  ('reports.view','View financial reports','reports'),
  ('audit.view','View audit log','audit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'super_admin'::app_role, id FROM public.permissions ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'admin'::app_role, id FROM public.permissions ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'manager'::app_role, id FROM public.permissions
WHERE code IN ('customers.create','customers.edit','loans.approve','loans.disburse','transactions.post','transactions.reverse','repayments.post','reports.view','audit.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'loan_officer'::app_role, id FROM public.permissions
WHERE code IN ('customers.create','customers.edit','loans.create','repayments.post','reports.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'finance_officer'::app_role, id FROM public.permissions
WHERE code IN ('transactions.post','repayments.post','reports.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'teller'::app_role, id FROM public.permissions
WHERE code IN ('customers.create','customers.edit','transactions.post')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'auditor'::app_role, id FROM public.permissions
WHERE code IN ('reports.view','audit.view')
ON CONFLICT DO NOTHING;

-- ========== AUDIT LOG ==========
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit viewable by privileged" ON public.audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'auditor'::app_role));
CREATE INDEX IF NOT EXISTS idx_audit_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id,action,table_name,record_id,old_data)
    VALUES (_uid,'DELETE',TG_TABLE_NAME,OLD.id,to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id,action,table_name,record_id,old_data,new_data)
    VALUES (_uid,'UPDATE',TG_TABLE_NAME,NEW.id,to_jsonb(OLD),to_jsonb(NEW));
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_log(user_id,action,table_name,record_id,new_data)
    VALUES (_uid,'INSERT',TG_TABLE_NAME,NEW.id,to_jsonb(NEW));
    RETURN NEW;
  END IF;
END $$;

DROP TRIGGER IF EXISTS audit_customers ON public.customers;
CREATE TRIGGER audit_customers AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
DROP TRIGGER IF EXISTS audit_loans ON public.loans;
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
DROP TRIGGER IF EXISTS audit_transactions ON public.transactions;
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
DROP TRIGGER IF EXISTS audit_user_roles ON public.user_roles;
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- ========== LOAN LIFECYCLE ==========
CREATE OR REPLACE FUNCTION public.enforce_loan_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
      ELSE false
    END;
    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid loan status transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'approved' AND NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'Maker-checker violation: loan creator cannot approve their own loan';
    END IF;
  END IF;

  IF OLD.disbursed_at IS NOT NULL THEN
    IF NEW.principal <> OLD.principal
       OR NEW.interest_rate <> OLD.interest_rate
       OR NEW.term_months <> OLD.term_months
       OR NEW.method <> OLD.method
       OR NEW.customer_id <> OLD.customer_id THEN
      RAISE EXCEPTION 'Loan cannot be edited after disbursement';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_loan_rules ON public.loans;
CREATE TRIGGER trg_enforce_loan_rules BEFORE UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_loan_rules();

CREATE OR REPLACE VIEW public.loan_portfolio AS
  SELECT * FROM public.loans WHERE status IN ('approved','disbursed','active','in_arrears');
GRANT SELECT ON public.loan_portfolio TO authenticated;

-- ========== KYC DOCUMENTS ==========
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  storage_path text NOT NULL,
  is_id_document boolean NOT NULL DEFAULT false,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view kyc" ON public.kyc_documents FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff upload kyc" ON public.kyc_documents FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Admin delete kyc" ON public.kyc_documents FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role));

INSERT INTO storage.buckets (id,name,public) VALUES ('kyc-documents','kyc-documents',false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff read kyc files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='kyc-documents' AND has_any_role(auth.uid()));
CREATE POLICY "Staff upload kyc files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='kyc-documents' AND has_any_role(auth.uid()));
CREATE POLICY "Admin delete kyc files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='kyc-documents' AND (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role)));

-- ========== GL ==========
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_class text NOT NULL CHECK (account_class IN ('asset','liability','equity','income','expense')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.chart_of_accounts (code,name,account_class) VALUES
  ('1000','Cash','asset'),
  ('1100','Loans Receivable','asset'),
  ('2000','Customer Deposits','liability'),
  ('3000','Equity','equity'),
  ('4000','Interest Income','income'),
  ('5000','Operating Expenses','expense')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text NOT NULL,
  description text,
  debit_account uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  credit_account uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  amount numeric NOT NULL CHECK (amount > 0),
  source_table text,
  source_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "COA viewable" ON public.chart_of_accounts FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Admin manage COA" ON public.chart_of_accounts FOR ALL TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "JE viewable" ON public.journal_entries FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff post JE" ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));

-- ========== NOTIFICATIONS ==========
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notifications view" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own notifications update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Staff insert notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id, is_read, created_at DESC);

-- ========== QUEUES ==========
CREATE TABLE IF NOT EXISTS public.sms_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_phone text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  customer_id uuid,
  loan_id uuid,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  customer_id uuid,
  loan_id uuid,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
ALTER TABLE public.sms_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view sms" ON public.sms_queue FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff insert sms" ON public.sms_queue FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));
CREATE POLICY "Staff view email" ON public.email_queue FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Staff insert email" ON public.email_queue FOR INSERT TO authenticated WITH CHECK (has_any_role(auth.uid()));

-- ========== REPAYMENTS ==========
CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.loans(id),
  amount numeric NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference text NOT NULL,
  posted_by uuid,
  reversed boolean NOT NULL DEFAULT false,
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view repayments" ON public.loan_repayments FOR SELECT TO authenticated USING (has_any_role(auth.uid()));
CREATE POLICY "Permitted post repayments" ON public.loan_repayments FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(),'repayments.post'));
CREATE POLICY "Privileged reverse repayments" ON public.loan_repayments FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'super_admin'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE OR REPLACE FUNCTION public.apply_repayment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.loans
       SET outstanding_balance = GREATEST(outstanding_balance - NEW.amount, 0),
           status = CASE WHEN outstanding_balance - NEW.amount <= 0 AND status IN ('active','in_arrears') THEN 'closed'::loan_status ELSE status END
     WHERE id = NEW.loan_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.reversed = true AND OLD.reversed = false THEN
    UPDATE public.loans
       SET outstanding_balance = outstanding_balance + NEW.amount,
           status = CASE WHEN status = 'closed' THEN 'active'::loan_status ELSE status END
     WHERE id = NEW.loan_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apply_repayment ON public.loan_repayments;
CREATE TRIGGER trg_apply_repayment AFTER INSERT OR UPDATE ON public.loan_repayments
  FOR EACH ROW EXECUTE FUNCTION public.apply_repayment();

DROP TRIGGER IF EXISTS trg_loans_updated ON public.loans;
CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.mark_overdue_loans()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.loans
     SET status = 'in_arrears'
   WHERE status = 'active'
     AND due_date IS NOT NULL
     AND due_date < CURRENT_DATE
     AND outstanding_balance > 0;
END $$;
