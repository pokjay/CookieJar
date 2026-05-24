export interface Summary {
  total: number;
  by_person: Record<string, number>;
  by_category: Record<string, number>;
  persons: string[];
  available_years: number[];
}

export interface YoyChange {
  [person: string]: number | null;
}

export interface AvgMonthly {
  avg_income: number;
  avg_expense: number;
}

export interface NetWorthPoint {
  activity_date: string;
  person: string;
  total_amount: number;
}

export interface NetWorthByCategoryPoint {
  activity_date: string;
  category: string;
  amount: number;
}

export interface CashFlowYearly {
  year: number;
  income: number;
  expense: number;
  savings: number;
  savings_pct: number;
  money_transferred: number;
  income_expense_diff: number;
}

export interface CashFlowMonthly {
  year: number;
  month: number;
  month_name: string;
  income: number;
  expense: number;
  savings: number;
  savings_pct: number;
  income_expense_diff: number;
}

export interface CashFlowMeta {
  persons: string[];
  available_years: number[];
}

export interface SankeyNode {
  name: string;
  depth: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  expandable_categories: string[];
}

export interface MonthlyAccountData {
  month: number;
  month_name: string;
  account: string;
  expense: number;
  income: number;
}

export interface Transaction {
  unique_id: string;
  activity_date: string;
  processed_description: string;
  charged_amount: number;
  charged_currency: string;
  category: string | null;
  subcategory: string | null;
  account: string;
  person: string;
}

export interface TravelTransaction {
  unique_id: string;
  activity_date: string;
  processed_description: string;
  charged_amount: number;
  charged_currency: string;
  subcategory: string | null;
  account: string;
  person: string;
}

export interface TravelBrowseMeta {
  persons: string[];
  accounts: string[];
  subcategories: string[];
  date_min: string;
  date_max: string;
  amount_min: number;
  amount_max: number;
}

export interface TravelTripSubcategory {
  subcategory: string;
  spend: number;
}

export interface TravelTrip {
  year: number;
  trip_label: string;
  start_date: string;
  end_date: string;
  total_spend: number;
  transaction_count: number;
  top_subcategories: TravelTripSubcategory[];
  name: string | null;
}

export interface TransactionBrowseMeta {
  persons: string[];
  accounts: string[];
  categories: string[];
  subcategories_by_category: Record<string, string[]>;
  date_min: string;
  date_max: string;
  amount_min: number;
  amount_max: number;
}

// --- Transactions Dashboard ---

export interface TxnDashboardMeta {
  available_years: number[];
  persons: string[];
}

export interface TxnDataHealth {
  last_transaction_date: string | null;
  uncategorized_count: number;
  uncategorized_pct: number;
  total_spend: number;
}

export interface TxnYoySpend {
  year: number;
  total_spend: number;
}

export interface TxnMonthlyYoy {
  year: number;
  month: number;
  month_name: string;
  spend: number;
}

export interface TxnMonthlyByAccount {
  month: number;
  month_name: string;
  account: string;
  spend: number;
}

export interface TxnAvgByCategory {
  category: string;
  avg_monthly_spend: number;
}

export interface TxnSubscription {
  name: string;
  max_amount: number;
  total_charges: number;
  total_spend: number;
}

export interface TxnCategoryTrend {
  category: string;
  month: number;
  month_name: string;
  spend: number;
}

export interface TxnTopBusiness {
  name: string;
  total_spend: number;
}

export interface TxnUncategorized {
  description: string;
  count: number;
  total: number;
}

export interface TxnHeatmapPoint {
  category: string;
  dow: number;
  day_name: string;
  spend: number;
}

export interface InvestmentAccount {
  id: number;
  person: string;
  company: string;
  account_type: string;
  account_type_en: string;
  account_type_category: string | null;
  is_active: boolean;
  is_pension: boolean;
  deposit_management_fees: number | null;
  acc_management_fees: number | null;
  investment_track: string | null;
  monthly_deposit: number | null;
  account_number: string | null;
  latest_amount: number | null;
  last_updated: string | null;
}

export interface UncategorizedDescription {
  processed_description: string;
  count: number;
  total_amount: number;
  account: string;
  last_date: string;
}

export interface CategoryMappingPayload {
  description: string;
  category: string;
  subcategory: string;
}

export interface BusinessDescription {
  id: number;
  description: string;
}

export interface UnmappedBusinessDescription {
  description: string;
  unmapped_count: number;
  total_amount: number;
}

export interface UnmappedBusinessTransaction {
  unique_id: string;
  activity_date: string;
  processed_description: string;
  charged_amount: number;
}

export interface BusinessMappingItem {
  unique_id: string;
  business_descriptions_id: number;
}

export interface ManualTransactionsMeta {
  currencies: string[];
  cash_flow_types: string[];
}

export interface ManualTransactionPayload {
  unique_id?: string;
  account: string;
  activity_date: string;
  charged_amount?: number;
  charged_currency: string;
  original_amount: number;
  original_currency: string;
  description: string;
  identifier?: string;
  additional_info?: string;
  charged_date?: string;
  cash_flow_type: string;
  show_in_transactions?: boolean;
}

export interface BulkImportPayload {
  rows: ManualTransactionPayload[];
}

export interface CreateAccountPayload {
  person: string;
  company: string;
  account_type: string;
  account_type_category: string | null;
  is_active: boolean;
  is_pension: boolean;
  deposit_management_fees: number | null;
  acc_management_fees: number | null;
  investment_track: string | null;
  monthly_deposit: number | null;
  account_number: string | null;
}

export interface AppSettings {
  cfg_parent1: string | null;
  cfg_parent2: string | null;
  cfg_kids: string[];
  sign_flipped_accounts: string[];
  cash_flow_accounts: string[];
  account_person_mapping: Record<string, string>;
}
