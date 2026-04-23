
-- Roles enum and table
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'teller', 'loan_officer', 'auditor');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

-- Customer types
CREATE TYPE public.customer_type AS ENUM ('individual', 'sme', 'corporate');
CREATE TYPE public.kyc_status AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_number TEXT NOT NULL UNIQUE,
  customer_type public.customer_type NOT NULL DEFAULT 'individual',
  full_name TEXT NOT NULL,
  national_id TEXT,
  date_of_birth DATE,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'Kenya',
  occupation TEXT,
  employer TEXT,
  monthly_income NUMERIC(14,2),
  kyc_status public.kyc_status NOT NULL DEFAULT 'pending',
  kyc_notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE public.account_type AS ENUM ('savings', 'current', 'fixed_deposit', 'loan');
CREATE TYPE public.account_status AS ENUM ('active', 'dormant', 'closed', 'frozen');

CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  account_type public.account_type NOT NULL,
  status public.account_status NOT NULL DEFAULT 'active',
  balance NUMERIC(16,2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(6,3) DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE public.loan_status AS ENUM ('pending', 'approved', 'disbursed', 'active', 'closed', 'rejected', 'in_arrears');
CREATE TYPE public.loan_method AS ENUM ('flat', 'reducing_balance', 'amortized');

CREATE TABLE public.loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  account_id UUID REFERENCES public.accounts(id),
  principal NUMERIC(16,2) NOT NULL,
  interest_rate NUMERIC(6,3) NOT NULL,
  term_months INT NOT NULL,
  method public.loan_method NOT NULL DEFAULT 'reducing_balance',
  status public.loan_status NOT NULL DEFAULT 'pending',
  outstanding_balance NUMERIC(16,2) NOT NULL DEFAULT 0,
  disbursed_at TIMESTAMPTZ,
  next_payment_date DATE,
  purpose TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE public.txn_type AS ENUM ('deposit', 'withdrawal', 'transfer', 'loan_disbursement', 'loan_repayment', 'fee', 'interest');
CREATE TYPE public.txn_status AS ENUM ('pending', 'completed', 'reversed', 'failed');

CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  txn_type public.txn_type NOT NULL,
  amount NUMERIC(16,2) NOT NULL,
  account_id UUID REFERENCES public.accounts(id),
  counterparty_account_id UUID REFERENCES public.accounts(id),
  status public.txn_status NOT NULL DEFAULT 'completed',
  description TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Profiles viewable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- user_roles policies
CREATE POLICY "Roles viewable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Customers: any staff can view, tellers+ can create/update
CREATE POLICY "Staff view customers" ON public.customers FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff create customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller') OR public.has_role(auth.uid(),'loan_officer'));
CREATE POLICY "Staff update customers" ON public.customers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller') OR public.has_role(auth.uid(),'loan_officer'));
CREATE POLICY "Admins delete customers" ON public.customers FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Accounts
CREATE POLICY "Staff view accounts" ON public.accounts FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff create accounts" ON public.accounts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller'));
CREATE POLICY "Staff update accounts" ON public.accounts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller'));

-- Loans
CREATE POLICY "Staff view loans" ON public.loans FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Loan officers create loans" ON public.loans FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer'));
CREATE POLICY "Managers update loans" ON public.loans FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'loan_officer'));

-- Transactions
CREATE POLICY "Staff view transactions" ON public.transactions FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "Staff create transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'teller'));

-- Trigger to auto-create profile and assign default 'admin' role to first user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'teller');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_loans_updated BEFORE UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
