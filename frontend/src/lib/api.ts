import type {
  ManualTransactionsMeta,
  ManualTransactionPayload,
  BulkImportPayload,
  Summary,
  YoyChange,
  AvgMonthly,
  NetWorthPoint,
  NetWorthByCategoryPoint,
  CashFlowYearly,
  CashFlowMonthly,
  CashFlowMeta,
  MonthlyAccountData,
  SankeyData,
  Transaction,
  TransactionBrowseMeta,
  TravelTransaction,
  TravelBrowseMeta,
  TravelTrip,
  TxnDashboardMeta,
  TxnDataHealth,
  TxnYoySpend,
  TxnMonthlyYoy,
  TxnMonthlyByAccount,
  TxnAvgByCategory,
  TxnSubscription,
  TxnCategoryTrend,
  TxnTopBusiness,
  TxnUncategorized,
  TxnHeatmapPoint,
  InvestmentAccount,
  CreateAccountPayload,
  UncategorizedDescription,
  CategoryMappingPayload,
  AppSettings,
  BusinessDescription,
  UnmappedBusinessDescription,
  UnmappedBusinessTransaction,
  BusinessMappingItem,
} from "./types";

// Empty string = relative URL; Next.js rewrites proxy /api/* to the backend.
// Set BACKEND_URL env var on the Next.js server to point to a non-default backend.
const BASE_URL = "";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function getSummary(): Promise<Summary> {
  return fetchJson("/api/overview/summary");
}

export function getYoyChange(year: number): Promise<YoyChange> {
  return fetchJson(`/api/overview/yoy-change?year=${year}`);
}

export function getAvgMonthly(year: number): Promise<AvgMonthly> {
  return fetchJson(`/api/overview/avg-monthly?year=${year}`);
}

export function getNetWorthOverTime(
  persons: string[]
): Promise<NetWorthPoint[]> {
  return fetchJson(
    `/api/overview/net-worth-over-time?persons=${encodeURIComponent(persons.join(","))}`
  );
}

export function getNetWorthByCategory(
  person?: string
): Promise<NetWorthByCategoryPoint[]> {
  const q = person ? `?person=${encodeURIComponent(person)}` : "";
  return fetchJson(`/api/overview/net-worth-by-category${q}`);
}

export function getCashFlowYearly(
  person?: string
): Promise<CashFlowYearly[]> {
  const q = person ? `?person=${encodeURIComponent(person)}` : "";
  return fetchJson(`/api/overview/cash-flow/yearly${q}`);
}

export function getCashFlowMonthly(
  year: number,
  person?: string
): Promise<CashFlowMonthly[]> {
  let q = `?year=${year}`;
  if (person) q += `&person=${encodeURIComponent(person)}`;
  return fetchJson(`/api/overview/cash-flow/monthly${q}`);
}

export function getCashFlowMeta(): Promise<CashFlowMeta> {
  return fetchJson("/api/cash-flow/meta");
}

export function getCashFlowYearlyPage(person?: string): Promise<CashFlowYearly[]> {
  const q = person ? `?person=${encodeURIComponent(person)}` : "";
  return fetchJson(`/api/cash-flow/yearly${q}`);
}

export function getCashFlowMonthlyPage(
  year: number,
  person?: string
): Promise<CashFlowMonthly[]> {
  let q = `?year=${year}`;
  if (person) q += `&person=${encodeURIComponent(person)}`;
  return fetchJson(`/api/cash-flow/monthly${q}`);
}

export function getCashFlowMonthlyByAccount(
  year: number,
  person?: string
): Promise<MonthlyAccountData[]> {
  let q = `?year=${year}`;
  if (person) q += `&person=${encodeURIComponent(person)}`;
  return fetchJson(`/api/cash-flow/monthly-by-account${q}`);
}

export function getCashFlowSankey(
  year: number,
  person?: string,
  expanded?: string[]
): Promise<SankeyData> {
  let q = `?year=${year}`;
  if (person) q += `&person=${encodeURIComponent(person)}`;
  if (expanded && expanded.length > 0) q += `&expanded=${encodeURIComponent(expanded.join(","))}`;
  return fetchJson(`/api/cash-flow/sankey${q}`);
}

export function getTransactionsBrowse(): Promise<Transaction[]> {
  return fetchJson("/api/transactions/browse");
}

export function getTransactionsBrowseMeta(): Promise<TransactionBrowseMeta> {
  return fetchJson("/api/transactions/browse/meta");
}

// --- Transactions Dashboard ---

export function getTxnDashboardMeta(): Promise<TxnDashboardMeta> {
  return fetchJson("/api/transactions/dashboard/meta");
}

export function getTxnDataHealth(year: number): Promise<TxnDataHealth> {
  return fetchJson(`/api/transactions/dashboard/data-health?year=${year}`);
}

export function getTxnYoySpend(): Promise<TxnYoySpend[]> {
  return fetchJson("/api/transactions/dashboard/yoy-spend");
}

export function getTxnMonthlyYoy(year: number): Promise<TxnMonthlyYoy[]> {
  return fetchJson(`/api/transactions/dashboard/monthly-yoy?year=${year}`);
}

export function getTxnMonthlyByAccount(year: number): Promise<TxnMonthlyByAccount[]> {
  return fetchJson(`/api/transactions/dashboard/monthly-by-account?year=${year}`);
}

export function getTxnAvgByCategory(year: number): Promise<TxnAvgByCategory[]> {
  return fetchJson(`/api/transactions/dashboard/avg-by-category?year=${year}`);
}

export function getTxnSubscriptions(year: number): Promise<TxnSubscription[]> {
  return fetchJson(`/api/transactions/dashboard/subscriptions?year=${year}`);
}

export function getTxnCategoryTrends(year: number): Promise<TxnCategoryTrend[]> {
  return fetchJson(`/api/transactions/dashboard/category-trends?year=${year}`);
}

export function getTxnTopBusinesses(year: number): Promise<TxnTopBusiness[]> {
  return fetchJson(`/api/transactions/dashboard/top-businesses?year=${year}`);
}

export function getTxnUncategorized(year: number): Promise<TxnUncategorized[]> {
  return fetchJson(`/api/transactions/dashboard/uncategorized?year=${year}`);
}

export function getTxnHeatmap(year: number): Promise<TxnHeatmapPoint[]> {
  return fetchJson(`/api/transactions/dashboard/heatmap?year=${year}`);
}

// --- Travel ---

export function getTravelBrowse(): Promise<TravelTransaction[]> {
  return fetchJson("/api/travel/browse");
}

export function getTravelBrowseMeta(): Promise<TravelBrowseMeta> {
  return fetchJson("/api/travel/browse/meta");
}

export function getTravelDashboardMeta(): Promise<TxnDashboardMeta> {
  return fetchJson("/api/travel/dashboard/meta");
}

export function getTravelDataHealth(year: number): Promise<TxnDataHealth> {
  return fetchJson(`/api/travel/dashboard/data-health?year=${year}`);
}

export function getTravelYoySpend(): Promise<TxnYoySpend[]> {
  return fetchJson("/api/travel/dashboard/yoy-spend");
}

export function getTravelMonthlyYoy(year: number): Promise<TxnMonthlyYoy[]> {
  return fetchJson(`/api/travel/dashboard/monthly-yoy?year=${year}`);
}

export function getTravelMonthlyByAccount(year: number): Promise<TxnMonthlyByAccount[]> {
  return fetchJson(`/api/travel/dashboard/monthly-by-account?year=${year}`);
}

export function getTravelAvgBySubcategory(year: number): Promise<TxnAvgByCategory[]> {
  return fetchJson(`/api/travel/dashboard/avg-by-subcategory?year=${year}`);
}

export function getTravelSubcategoryTrends(year: number): Promise<TxnCategoryTrend[]> {
  return fetchJson(`/api/travel/dashboard/subcategory-trends?year=${year}`);
}

export function getTravelTopBusinesses(year: number): Promise<TxnTopBusiness[]> {
  return fetchJson(`/api/travel/dashboard/top-businesses?year=${year}`);
}

export function getTravelHeatmap(year: number): Promise<TxnHeatmapPoint[]> {
  return fetchJson(`/api/travel/dashboard/heatmap?year=${year}`);
}

export function getTravelTrips(): Promise<TravelTrip[]> {
  return fetchJson("/api/travel/dashboard/trips");
}

export async function setTravelTripName(
  startDate: string,
  name: string | null
): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE_URL}/api/travel/trips/${startDate}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// --- Investments ---

// --- Categories ---

export function getCategoryHierarchy(): Promise<Record<string, string[]>> {
  return fetchJson("/api/categories/hierarchy");
}

export function getUncategorizedDescriptions(): Promise<UncategorizedDescription[]> {
  return fetchJson("/api/categories/uncategorized");
}

export function createCategoryMapping(
  payload: CategoryMappingPayload
): Promise<{ ok: boolean }> {
  return fetch(`${BASE_URL}/api/categories/mapping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean }>;
  });
}

// --- Business Mapping ---

export function getBusinessDescriptions(): Promise<BusinessDescription[]> {
  return fetchJson("/api/business/descriptions");
}

export function getUnmappedBusinessDescriptions(): Promise<UnmappedBusinessDescription[]> {
  return fetchJson("/api/business/unmapped");
}

export function getUnmappedBusinessTransactions(
  description: string
): Promise<UnmappedBusinessTransaction[]> {
  return fetchJson(
    `/api/business/transactions?description=${encodeURIComponent(description)}`
  );
}

export function createBusinessDescription(
  description: string
): Promise<{ ok: boolean; id?: number; description?: string }> {
  return fetch(`${BASE_URL}/api/business/description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json();
  });
}

export function createBusinessMappings(
  mappings: BusinessMappingItem[]
): Promise<{ ok: boolean; saved: number }> {
  return fetch(`${BASE_URL}/api/business/mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mappings }),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json();
  });
}

// --- Manual Transactions ---

export function getManualTransactionsMeta(): Promise<ManualTransactionsMeta> {
  return fetchJson("/api/manual-transactions/meta");
}

export function checkDuplicate(payload: ManualTransactionPayload): Promise<{ is_duplicate: boolean }> {
  return fetch(`${BASE_URL}/api/manual-transactions/check-duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json();
  });
}

export function createManualTransaction(payload: ManualTransactionPayload): Promise<{ ok: boolean }> {
  return fetch(`${BASE_URL}/api/manual-transactions/single`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json();
  });
}

export function bulkImportTransactions(payload: BulkImportPayload): Promise<{ ok: boolean; imported: number }> {
  return fetch(`${BASE_URL}/api/manual-transactions/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json();
  });
}

export function getInvestmentAccounts(): Promise<InvestmentAccount[]> {
  return fetchJson("/api/investments/accounts");
}

export function createInvestmentAccount(
  payload: CreateAccountPayload
): Promise<InvestmentAccount> {
  return fetch(`${BASE_URL}/api/investments/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<InvestmentAccount>;
  });
}

export function upsertInvestmentBalance(
  accountId: number,
  amount: number,
  date: string
): Promise<{ ok: boolean }> {
  return fetch(`${BASE_URL}/api/investments/accounts/${accountId}/balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, date }),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean }>;
  });
}

// --- Settings ---

export function getSettings(): Promise<AppSettings> {
  return fetchJson("/api/settings");
}

export function saveSettings(settings: AppSettings): Promise<{ ok: boolean }> {
  return fetch(`${BASE_URL}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean }>;
  });
}

export function getSettingsPersons(): Promise<string[]> {
  return fetchJson("/api/settings/persons");
}

export function getSettingsAccounts(): Promise<string[]> {
  return fetchJson("/api/settings/accounts");
}

export function getCategoryMappingsCount(): Promise<{ count: number }> {
  return fetchJson("/api/settings/category-mappings/count");
}

export function resetCategoryMappings(): Promise<{ ok: boolean; deleted: number }> {
  return fetch(`${BASE_URL}/api/settings/category-mappings`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean; deleted: number }>;
  });
}

export function getBusinessMappingsCount(): Promise<{ count: number }> {
  return fetchJson("/api/settings/business-mappings/count");
}

export function resetBusinessMappings(): Promise<{ ok: boolean; deleted: number }> {
  return fetch(`${BASE_URL}/api/settings/business-mappings`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<{ ok: boolean; deleted: number }>;
  });
}
