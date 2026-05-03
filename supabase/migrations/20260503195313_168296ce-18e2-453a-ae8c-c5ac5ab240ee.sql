
CREATE TABLE public.guarantors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  national_id text NOT NULL,
  phone text NOT NULL,
  email text,
  relationship text,
  address text,
  occupation text,
  monthly_income numeric,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_guarantors_customer ON public.guarantors(customer_id);

ALTER TABLE public.guarantors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view guarantors" ON public.guarantors
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid()));

CREATE POLICY "Staff create guarantors" ON public.guarantors
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller')
  OR public.has_role(auth.uid(),'loan_officer')
);

CREATE POLICY "Staff update guarantors" ON public.guarantors
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller')
  OR public.has_role(auth.uid(),'loan_officer')
);

CREATE POLICY "Admins delete guarantors" ON public.guarantors
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_guarantors_updated_at
BEFORE UPDATE ON public.guarantors
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
