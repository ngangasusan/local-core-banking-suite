-- PR6: loan products (rules per loan category) + link from loans

CREATE TABLE IF NOT EXISTS loan_products (
  id CHAR(36) NOT NULL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  method ENUM('flat','reducing_balance','amortized') NOT NULL DEFAULT 'flat',
  min_principal DECIMAL(18,2) NOT NULL DEFAULT 1000,
  max_principal DECIMAL(18,2) NOT NULL DEFAULT 100000,
  interest_rate DECIMAL(9,4) NOT NULL DEFAULT 20,
  min_term_months INT NOT NULL DEFAULT 1,
  max_term_months INT NOT NULL DEFAULT 12,
  min_principal_pct DECIMAL(9,4) NOT NULL DEFAULT 10,
  daily_interest_rate DECIMAL(9,4) NOT NULL DEFAULT 2,
  late_fee_daily_pct DECIMAL(9,4) NOT NULL DEFAULT 1,
  grace_period_days INT NOT NULL DEFAULT 0,
  mpesa_fee_threshold DECIMAL(18,2) NOT NULL DEFAULT 10000,
  mpesa_fee_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  early_repayment_days INT NOT NULL DEFAULT 5,
  required_credit_score INT NOT NULL DEFAULT 400,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

ALTER TABLE loans ADD COLUMN product_id CHAR(36) NULL;

ALTER TABLE loans ADD CONSTRAINT loans_product_fk
  FOREIGN KEY (product_id) REFERENCES loan_products(id) ON DELETE SET NULL;

INSERT IGNORE INTO loan_products
  (id, code, name, description, min_principal, max_principal, interest_rate,
   min_term_months, max_term_months, mpesa_fee_threshold, required_credit_score)
VALUES
  (UUID(), 'MICRO', 'Micro Loan', 'Small short-term loans', 1000, 50000, 20, 1, 6, 10000, 400),
  (UUID(), 'SME', 'SME Loan', 'Business working capital', 50000, 1000000, 18, 3, 24, 10000, 550),
  (UUID(), 'SALARY', 'Salary Advance', 'Advance against payroll', 5000, 200000, 15, 1, 3, 10000, 500),
  (UUID(), 'EMERG', 'Emergency Loan', 'Fast disbursement emergency facility', 1000, 30000, 25, 1, 3, 10000, 350);
