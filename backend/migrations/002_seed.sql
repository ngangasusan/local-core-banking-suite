-- Seed: chart of accounts (matches the codes used by accounting service)
INSERT IGNORE INTO chart_of_accounts (id, code, name, account_class) VALUES
  (UUID(), '1000', 'Cash',                'asset'),
  (UUID(), '1100', 'Loans Receivable',    'asset'),
  (UUID(), '2000', 'Customer Deposits',   'liability'),
  (UUID(), '3000', 'Equity',              'equity'),
  (UUID(), '4000', 'Interest Income',     'income'),
  (UUID(), '4100', 'Penalty Income',      'income'),
  (UUID(), '4200', 'Fee Income',          'income'),
  (UUID(), '5000', 'Operating Expense',   'expense'),
  (UUID(), '5100', 'Bad Debt Expense',    'expense');

-- Seed: baseline permissions (used by the existing UI)
INSERT IGNORE INTO permissions (id, code, description, category) VALUES
  (UUID(), 'repayments.post',           'Post loan repayments',     'loans'),
  (UUID(), 'repayments.reverse',        'Reverse loan repayments',  'loans'),
  (UUID(), 'loans.approve',             'Approve loan applications','loans'),
  (UUID(), 'loans.disburse',            'Disburse approved loans',  'loans'),
  (UUID(), 'kyc.verify',                'Verify customer KYC',      'customers'),
  (UUID(), 'coa.manage',                'Manage chart of accounts', 'accounting'),
  (UUID(), 'writeoffs.approve',         'Approve loan write-offs',  'collections');
