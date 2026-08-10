-- PR7: configurable tiered interest rules per loan product.
-- Tier 1 (0..tier1_days)            -> min_principal_pct of principal
-- Tier 2 (tier1_days+1..tier2_days) -> MAX(min pct, daily_per_1000 per 1,000 per day)
-- Tier 3 (beyond tier2_days)        -> monthly_pct of principal per started month (monthly_days)

ALTER TABLE loan_products ADD COLUMN tier1_days INT NOT NULL DEFAULT 5;
ALTER TABLE loan_products ADD COLUMN tier2_days INT NOT NULL DEFAULT 14;
ALTER TABLE loan_products ADD COLUMN daily_per_1000 DECIMAL(12,4) NOT NULL DEFAULT 20;
ALTER TABLE loan_products ADD COLUMN monthly_days INT NOT NULL DEFAULT 30;
ALTER TABLE loan_products ADD COLUMN monthly_pct DECIMAL(9,4) NOT NULL DEFAULT 0.30;

-- Existing rows keep the house standard (10% minimum) unless configured otherwise.
UPDATE loan_products SET min_principal_pct = 0.10 WHERE min_principal_pct > 1;
