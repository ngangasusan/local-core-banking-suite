
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'finance_officer';
DO $$ BEGIN
  ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'draft';
EXCEPTION WHEN others THEN NULL; END $$;
