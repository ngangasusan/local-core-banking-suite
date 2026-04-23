export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_number: string
          account_type: Database["public"]["Enums"]["account_type"]
          balance: number
          created_at: string
          currency: string
          customer_id: string
          id: string
          interest_rate: number | null
          opened_at: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
        }
        Insert: {
          account_number: string
          account_type: Database["public"]["Enums"]["account_type"]
          balance?: number
          created_at?: string
          currency?: string
          customer_id: string
          id?: string
          interest_rate?: number | null
          opened_at?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Update: {
          account_number?: string
          account_type?: Database["public"]["Enums"]["account_type"]
          balance?: number
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          interest_rate?: number | null
          opened_at?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          customer_number: string
          customer_type: Database["public"]["Enums"]["customer_type"]
          date_of_birth: string | null
          email: string | null
          employer: string | null
          full_name: string
          id: string
          kyc_notes: string | null
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          monthly_income: number | null
          national_id: string | null
          occupation: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          customer_number: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          date_of_birth?: string | null
          email?: string | null
          employer?: string | null
          full_name: string
          id?: string
          kyc_notes?: string | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          monthly_income?: number | null
          national_id?: string | null
          occupation?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          customer_number?: string
          customer_type?: Database["public"]["Enums"]["customer_type"]
          date_of_birth?: string | null
          email?: string | null
          employer?: string | null
          full_name?: string
          id?: string
          kyc_notes?: string | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          monthly_income?: number | null
          national_id?: string | null
          occupation?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          account_id: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          disbursed_at: string | null
          id: string
          interest_rate: number
          loan_number: string
          method: Database["public"]["Enums"]["loan_method"]
          next_payment_date: string | null
          outstanding_balance: number
          principal: number
          purpose: string | null
          status: Database["public"]["Enums"]["loan_status"]
          term_months: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          disbursed_at?: string | null
          id?: string
          interest_rate: number
          loan_number: string
          method?: Database["public"]["Enums"]["loan_method"]
          next_payment_date?: string | null
          outstanding_balance?: number
          principal: number
          purpose?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          term_months: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          disbursed_at?: string | null
          id?: string
          interest_rate?: number
          loan_number?: string
          method?: Database["public"]["Enums"]["loan_method"]
          next_payment_date?: string | null
          outstanding_balance?: number
          principal?: number
          purpose?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          term_months?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          branch: string | null
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          branch?: string | null
          created_at?: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          branch?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          counterparty_account_id: string | null
          created_at: string
          description: string | null
          id: string
          performed_by: string | null
          reference: string
          status: Database["public"]["Enums"]["txn_status"]
          txn_type: Database["public"]["Enums"]["txn_type"]
        }
        Insert: {
          account_id?: string | null
          amount: number
          counterparty_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          performed_by?: string | null
          reference: string
          status?: Database["public"]["Enums"]["txn_status"]
          txn_type: Database["public"]["Enums"]["txn_type"]
        }
        Update: {
          account_id?: string | null
          amount?: number
          counterparty_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          performed_by?: string | null
          reference?: string
          status?: Database["public"]["Enums"]["txn_status"]
          txn_type?: Database["public"]["Enums"]["txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_account_id_fkey"
            columns: ["counterparty_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_status: "active" | "dormant" | "closed" | "frozen"
      account_type: "savings" | "current" | "fixed_deposit" | "loan"
      app_role: "admin" | "manager" | "teller" | "loan_officer" | "auditor"
      customer_type: "individual" | "sme" | "corporate"
      kyc_status: "pending" | "verified" | "rejected"
      loan_method: "flat" | "reducing_balance" | "amortized"
      loan_status:
        | "pending"
        | "approved"
        | "disbursed"
        | "active"
        | "closed"
        | "rejected"
        | "in_arrears"
      txn_status: "pending" | "completed" | "reversed" | "failed"
      txn_type:
        | "deposit"
        | "withdrawal"
        | "transfer"
        | "loan_disbursement"
        | "loan_repayment"
        | "fee"
        | "interest"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "dormant", "closed", "frozen"],
      account_type: ["savings", "current", "fixed_deposit", "loan"],
      app_role: ["admin", "manager", "teller", "loan_officer", "auditor"],
      customer_type: ["individual", "sme", "corporate"],
      kyc_status: ["pending", "verified", "rejected"],
      loan_method: ["flat", "reducing_balance", "amortized"],
      loan_status: [
        "pending",
        "approved",
        "disbursed",
        "active",
        "closed",
        "rejected",
        "in_arrears",
      ],
      txn_status: ["pending", "completed", "reversed", "failed"],
      txn_type: [
        "deposit",
        "withdrawal",
        "transfer",
        "loan_disbursement",
        "loan_repayment",
        "fee",
        "interest",
      ],
    },
  },
} as const
