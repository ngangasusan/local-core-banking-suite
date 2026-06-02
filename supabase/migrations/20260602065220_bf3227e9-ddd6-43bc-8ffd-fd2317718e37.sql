
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by self or admin" ON public.profiles;
CREATE POLICY "Profiles viewable by self or admin"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "Roles viewable by authenticated" ON public.user_roles;
DROP POLICY IF EXISTS "Roles viewable by self or admin" ON public.user_roles;
CREATE POLICY "Roles viewable by self or admin"
ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "Admin update kyc files" ON storage.objects;
CREATE POLICY "Admin update kyc files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'kyc-documents'
  AND (public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'admin'::app_role))
)
WITH CHECK (
  bucket_id = 'kyc-documents'
  AND (public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'admin'::app_role))
);

ALTER VIEW public.daily_recon SET (security_invoker = on);

ALTER FUNCTION public.compute_late_fee(numeric, integer) SET search_path = public;
ALTER FUNCTION public.compute_loan_interest(numeric, integer) SET search_path = public;
ALTER FUNCTION public.compute_loan_total_due(numeric, integer) SET search_path = public;
ALTER FUNCTION public.je_validate() SET search_path = public;
ALTER FUNCTION public.mpesa_send_charge(numeric) SET search_path = public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_mfa(uuid) TO authenticated;
