-- PR5: bank reconciliation tables + notification templates.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS bank_statements (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  bank_name     VARCHAR(100) NOT NULL,
  account_ref   VARCHAR(100) NOT NULL,
  period_start  DATE         NOT NULL,
  period_end    DATE         NOT NULL,
  opening_bal   DECIMAL(18,2) NOT NULL DEFAULT 0,
  closing_bal   DECIMAL(18,2) NOT NULL DEFAULT 0,
  imported_by   CHAR(36)         NULL,
  imported_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_bs_period (period_start, period_end),
  CONSTRAINT fk_bs_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  statement_id    CHAR(36)      NOT NULL,
  txn_date        DATE          NOT NULL,
  reference       VARCHAR(200)  NOT NULL,
  description     TEXT              NULL,
  amount          DECIMAL(18,2) NOT NULL,
  direction       ENUM('credit','debit') NOT NULL,
  status          ENUM('unmatched','matched','ignored') NOT NULL DEFAULT 'unmatched',
  matched_repayment_id CHAR(36)     NULL,
  matched_by      CHAR(36)          NULL,
  matched_at      DATETIME(3)       NULL,
  notes           TEXT              NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_bsl_stmt (statement_id),
  KEY ix_bsl_status (status),
  KEY ix_bsl_ref (reference),
  CONSTRAINT fk_bsl_stmt FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE,
  CONSTRAINT fk_bsl_rep  FOREIGN KEY (matched_repayment_id) REFERENCES loan_repayments(id) ON DELETE SET NULL,
  CONSTRAINT fk_bsl_user FOREIGN KEY (matched_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO schema_migrations(name) VALUES ('003_pr5') ON DUPLICATE KEY UPDATE name=name;
