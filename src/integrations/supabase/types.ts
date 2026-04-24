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
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_class: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          account_class: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          account_class?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
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
          is_active: boolean
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
          is_active?: boolean
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
          is_active?: boolean
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
      email_queue: {
        Row: {
          attempts: number
          body: string
          created_at: string
          customer_id: string | null
          id: string
          last_error: string | null
          loan_id: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          loan_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          to_email: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          loan_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          credit_account: string
          debit_account: string
          description: string | null
          entry_date: string
          id: string
          reference: string
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          credit_account: string
          debit_account: string
          description?: string | null
          entry_date?: string
          id?: string
          reference: string
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_account?: string
          debit_account?: string
          description?: string | null
          entry_date?: string
          id?: string
          reference?: string
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_credit_account_fkey"
            columns: ["credit_account"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_debit_account_fkey"
            columns: ["debit_account"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          customer_id: string
          doc_type: string
          id: string
          is_id_document: boolean
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          customer_id: string
          doc_type: string
          id?: string
          is_id_document?: boolean
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          customer_id?: string
          doc_type?: string
          id?: string
          is_id_document?: boolean
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_repayments: {
        Row: {
          amount: number
          created_at: string
          id: string
          loan_id: string
          paid_at: string
          posted_by: string | null
          reference: string
          reversal_reason: string | null
          reversed: boolean
          reversed_at: string | null
          reversed_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          loan_id: string
          paid_at?: string
          posted_by?: string | null
          reference: string
          reversal_reason?: string | null
          reversed?: boolean
          reversed_at?: string | null
          reversed_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          loan_id?: string
          paid_at?: string
          posted_by?: string | null
          reference?: string
          reversal_reason?: string | null
          reversed?: boolean
          reversed_at?: string | null
          reversed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_portfolio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          account_id: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          disbursed_at: string | null
          disbursement_date: string | null
          due_date: string | null
          id: string
          interest_rate: number
          loan_number: string
          method: Database["public"]["Enums"]["loan_method"]
          next_payment_date: string | null
          outstanding_balance: number
          principal: number
          purpose: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["loan_status"]
          submitted_for_approval_at: string | null
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
          disbursement_date?: string | null
          due_date?: string | null
          id?: string
          interest_rate: number
          loan_number: string
          method?: Database["public"]["Enums"]["loan_method"]
          next_payment_date?: string | null
          outstanding_balance?: number
          principal: number
          purpose?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          submitted_for_approval_at?: string | null
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
          disbursement_date?: string | null
          due_date?: string | null
          id?: string
          interest_rate?: number
          loan_number?: string
          method?: Database["public"]["Enums"]["loan_method"]
          next_payment_date?: string | null
          outstanding_balance?: number
          principal?: number
          purpose?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          submitted_for_approval_at?: string | null
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
      notifications: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string | null
          code: string
          created_at: string
          description: string | null
          id: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          branch: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          branch?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          branch?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_queue: {
        Row: {
          attempts: number
          created_at: string
          customer_id: string | null
          id: string
          last_error: string | null
          loan_id: string | null
          message: string
          sent_at: string | null
          status: string
          to_phone: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          loan_id?: string | null
          message: string
          sent_at?: string | null
          status?: string
          to_phone: string
        }
        Update: {
          attempts?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          last_error?: string | null
          loan_id?: string | null
          message?: string
          sent_at?: string | null
          status?: string
          to_phone?: string
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
      loan_portfolio: {
        Row: {
          account_id: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          disbursed_at: string | null
          disbursement_date: string | null
          due_date: string | null
          id: string | null
          interest_rate: number | null
          loan_number: string | null
          method: Database["public"]["Enums"]["loan_method"] | null
          next_payment_date: string | null
          outstanding_balance: number | null
          principal: number | null
          purpose: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["loan_status"] | null
          submitted_for_approval_at: string | null
          term_months: number | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          disbursed_at?: string | null
          disbursement_date?: string | null
          due_date?: string | null
          id?: string | null
          interest_rate?: number | null
          loan_number?: string | null
          method?: Database["public"]["Enums"]["loan_method"] | null
          next_payment_date?: string | null
          outstanding_balance?: number | null
          principal?: number | null
          purpose?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["loan_status"] | null
          submitted_for_approval_at?: string | null
          term_months?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          disbursed_at?: string | null
          disbursement_date?: string | null
          due_date?: string | null
          id?: string | null
          interest_rate?: number | null
          loan_number?: string | null
          method?: Database["public"]["Enums"]["loan_method"] | null
          next_payment_date?: string | null
          outstanding_balance?: number | null
          principal?: number | null
          purpose?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["loan_status"] | null
          submitted_for_approval_at?: string | null
          term_months?: number | null
          updated_at?: string | null
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
    }
    Functions: {
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_overdue_loans: { Args: never; Returns: undefined }
    }
    Enums: {
      account_status: "active" | "dormant" | "closed" | "frozen"
      account_type: "savings" | "current" | "fixed_deposit" | "loan"
      app_role:
        | "admin"
        | "manager"
        | "teller"
        | "loan_officer"
        | "auditor"
        | "super_admin"
        | "finance_officer"
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
        | "draft"
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
      app_role: [
        "admin",
        "manager",
        "teller",
        "loan_officer",
        "auditor",
        "super_admin",
        "finance_officer",
      ],
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
        "draft",
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
