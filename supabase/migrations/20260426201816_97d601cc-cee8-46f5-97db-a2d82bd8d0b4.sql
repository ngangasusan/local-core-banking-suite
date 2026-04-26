-- Allow super_admin to perform all staff operations across core tables

-- customers
DROP POLICY IF EXISTS "Staff create customers" ON public.customers;
CREATE POLICY "Staff create customers" ON public.customers FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'teller') OR has_role(auth.uid(),'loan_officer'));

DROP POLICY IF EXISTS "Staff update customers" ON public.customers;
CREATE POLICY "Staff update customers" ON public.customers FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'teller') OR has_role(auth.uid(),'loan_officer'));

DROP POLICY IF EXISTS "Admins delete customers" ON public.customers;
CREATE POLICY "Admins delete customers" ON public.customers FOR DELETE TO authenticated
USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin'));

-- accounts
DROP POLICY IF EXISTS "Staff create accounts" ON public.accounts;
CREATE POLICY "Staff create accounts" ON public.accounts FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'teller'));

DROP POLICY IF EXISTS "Staff update accounts" ON public.accounts;
CREATE POLICY "Staff update accounts" ON public.accounts FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'teller'));

-- transactions
DROP POLICY IF EXISTS "Staff create transactions" ON public.transactions;
CREATE POLICY "Staff create transactions" ON public.transactions FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'teller'));

-- loans
DROP POLICY IF EXISTS "Loan officers create loans" ON public.loans;
CREATE POLICY "Loan officers create loans" ON public.loans FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'loan_officer'));

DROP POLICY IF EXISTS "Managers update loans" ON public.loans;
CREATE POLICY "Managers update loans" ON public.loans FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'loan_officer'));