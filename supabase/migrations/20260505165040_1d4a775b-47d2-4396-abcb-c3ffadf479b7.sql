
REVOKE EXECUTE ON FUNCTION public.decrypt_customer_pii(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_customer_kyc(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_audit_chain() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recompute_loan_provisions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._pii_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decrypt_customer_pii(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_customer_kyc(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_loan_provisions() TO authenticated;
