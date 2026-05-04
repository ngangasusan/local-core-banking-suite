-- Replace the AFTER UPDATE trigger with one scoped to the reversal flip only,
-- so we don't double-post the GL on initial insert.
DROP TRIGGER IF EXISTS trg_apply_repayment_upd ON public.loan_repayments;
CREATE TRIGGER trg_apply_repayment_upd
  AFTER UPDATE OF reversed ON public.loan_repayments
  FOR EACH ROW
  WHEN (NEW.reversed = true AND OLD.reversed = false)
  EXECUTE FUNCTION public.apply_repayment();