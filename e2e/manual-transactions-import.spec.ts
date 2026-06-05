import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

// Issue #41: the CSV-import preview now lets the user edit cells per row.
// This test exercises the full path: upload → inline edits → import → DB
// verification.

const ACCOUNT = "e2e-bulk-edit";

// CSV intentionally omits cash_flow_type so we can verify the per-row editor
// is the only thing that sets it. activity_dates are unique to keep the upsert
// from collapsing rows when the test is rerun.
const CSV = [
  "account,activity_date,charged_currency,original_amount,original_currency,description",
  `${ACCOUNT},2026-05-01,ILS,5000.00,ILS,E2E salary deposit`,
  `${ACCOUNT},2026-05-02,ILS,45.50,ILS,E2E coffee shop`,
  `${ACCOUNT},2026-05-03,ILS,2000.00,ILS,E2E savings transfer`,
].join("\n");

const PG_CONFIG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "family_finance",
};

async function withPg<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(PG_CONFIG);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanupAccount() {
  await withPg(async (c) => {
    // LIKE so the row-1 alt-account variant (`${ACCOUNT}-alt`) is also wiped.
    await c.query(
      "DELETE FROM moneyman.transactions_manual WHERE account LIKE $1",
      [`${ACCOUNT}%`]
    );
  });
}

async function uploadCsv(page: Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  // Wait for the rows-summary header to appear instead of relying on a fixed delay.
  await expect(page.locator("text=/^\\d+ rows$/")).toBeVisible();
}

// Each preview row has data-testid="preview-row-<i>" and each editable cell has
// data-testid="preview-cell-<col>" — use those instead of column-index math so
// the test doesn't silently target the wrong cell when the column set changes.
function row(page: Page, rowIdx: number): Locator {
  return page.getByTestId(`preview-row-${rowIdx}`);
}

function cell(page: Page, rowIdx: number, col: string): Locator {
  return row(page, rowIdx).getByTestId(`preview-cell-${col}`).locator("input, select").first();
}

// Tests in this file share the moneyman.transactions_manual table — they all
// insert/clean up rows whose account starts with ACCOUNT. With Playwright's
// default parallelism they'd race (one test's beforeEach cleanup wipes another
// test's just-inserted rows mid-import), so force serial execution inside this
// file. Other spec files keep their parallelism via the project-level config.
test.describe.configure({ mode: "serial" });

test.describe("Manual Transactions — CSV Import with per-row editing (#41)", () => {
  test.beforeEach(cleanupAccount);
  test.afterEach(cleanupAccount);

  test("inline edits to each row are persisted to the database on import", async ({ page }) => {
    await page.goto("/manual-transactions");
    await page.getByRole("button", { name: /file import/i }).click();

    await uploadCsv(page);

    // No mapping needed: the CSV has every required column.
    await expect(page.getByText("Map Your Columns")).not.toBeVisible();
    await expect(page.locator("[data-testid^='preview-row-']")).toHaveCount(3);

    // Per-row cash_flow_type edits — the central use case of #41.
    await cell(page, 0, "cash_flow_type").selectOption("salary");
    await cell(page, 1, "cash_flow_type").selectOption("expense");
    await cell(page, 2, "cash_flow_type").selectOption("savings");

    // Override row 2's amount inline (proves text-cell editing flows through).
    await cell(page, 2, "original_amount").fill("1999.99");

    // Override row 0's description inline (proves another text-cell type works).
    await cell(page, 0, "description").fill("E2E salary deposit EDITED");

    // Account edit on row 1 — the row's CSV-provided account isn't in the known list,
    // so the AccountInput starts in "Other" mode (text input). Typing a new value
    // proves the inline text-input path lands in the DB.
    await cell(page, 1, "account").fill(`${ACCOUNT}-alt`);

    // Issue #48: the CSV omits show_in_transactions, so every row defaults to
    // checked. Uncheck row 2 to prove the per-row boolean toggle persists.
    await cell(page, 2, "show_in_transactions").uncheck();

    // All rows valid; import enabled.
    await expect(page.getByText("All valid")).toBeVisible();
    const importBtn = page.getByRole("button", { name: /Import 3 transactions?/i });
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect(page.getByText(/Successfully imported 3 transactions?/)).toBeVisible();

    // DB verification — query transactions_manual directly to prove edits landed.
    const rows = await withPg(async (c) => {
      const result = await c.query<{
        account: string;
        activity_date: Date;
        original_amount: string;
        description: string;
        cash_flow_type: string;
        show_in_transactions: boolean;
      }>(
        `SELECT account, activity_date, original_amount,
                description, cash_flow_type::text AS cash_flow_type,
                show_in_transactions
         FROM moneyman.transactions_manual
         WHERE account LIKE $1
         ORDER BY activity_date`,
        [`${ACCOUNT}%`]
      );
      return result.rows;
    });

    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      account: ACCOUNT,
      description: "E2E salary deposit EDITED",
      cash_flow_type: "salary",
      show_in_transactions: true,
    });
    expect(Number(rows[0].original_amount)).toBeCloseTo(5000.0, 2);

    expect(rows[1]).toMatchObject({
      account: `${ACCOUNT}-alt`,
      description: "E2E coffee shop",
      cash_flow_type: "expense",
      show_in_transactions: true,
    });

    // Row 2's checkbox was unchecked above — it must land hidden.
    expect(rows[2]).toMatchObject({
      account: ACCOUNT,
      description: "E2E savings transfer",
      cash_flow_type: "savings",
      show_in_transactions: false,
    });
    expect(Number(rows[2].original_amount)).toBeCloseTo(1999.99, 2);
  });

  test("blanking a required cell flags validation and blocks import", async ({ page }) => {
    await page.goto("/manual-transactions");
    await page.getByRole("button", { name: /file import/i }).click();
    await uploadCsv(page);

    const row1Amount = cell(page, 1, "original_amount");
    await row1Amount.fill("");

    await expect(page.getByText("1 error", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Fix 1 error first/i })).toBeDisabled();

    // Restore a value — error clears, import re-enables.
    await row1Amount.fill("123.45");
    await expect(page.getByText("All valid")).toBeVisible();
    await expect(page.getByRole("button", { name: /Import 3 transactions?/i })).toBeEnabled();
  });

  // Issue #45: the account fixed-value input used to be a datalist combobox that
  // looked like a plain text box. It's now a real <select> of existing accounts
  // with an "+ Other…" escape.
  test("mapper: account fixed-value field renders as a real <select> of existing accounts", async ({ page }) => {
    // Wait for the known-accounts fetch — the AccountInput dropdown is empty until
    // this resolves, and selecting "+ Other…" before it does would race the test.
    const accountsLoaded = page.waitForResponse(
      (r) => r.url().includes("/api/settings/accounts") && r.status() === 200,
    );

    await page.goto("/manual-transactions");
    await page.getByRole("button", { name: /file import/i }).click();
    await accountsLoaded;

    // CSV missing the `account` column — forces the column mapper to open.
    const noAccountCsv = [
      "activity_date,charged_currency,original_amount,original_currency,description",
      "2026-05-10,ILS,100.00,ILS,No-account row",
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({
      name: "no-account.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(noAccountCsv),
    });
    await expect(page.getByText("Map Your Columns")).toBeVisible();

    // The `account` row in the mapper's field-mapping grid: its first <select>
    // is the source picker. Switch it to "enter fixed value".
    const accountRow = page
      .locator("div.flex.items-start.gap-3")
      .filter({ has: page.locator("span", { hasText: /^account$/ }) });
    await accountRow.locator("select").first().selectOption({ value: "__fixed__" });

    // The second <select> in the row is the AccountInput's dropdown — wait for it
    // to actually render before reading its options.
    const fixedAccountSelect = accountRow.locator("select").nth(1);
    await expect(fixedAccountSelect).toBeVisible();

    // The "+ Other…" escape option is always present (doesn't depend on the API).
    await expect(fixedAccountSelect.locator("option[value='__other__']")).toHaveCount(1);

    // And at least one account option pulled from /api/settings/accounts must appear.
    // Polled so a slow CI fetch doesn't race the assertion.
    await expect
      .poll(
        async () =>
          fixedAccountSelect
            .locator("option:not([value='']):not([value='__other__'])")
            .count(),
      )
      .toBeGreaterThan(0);

    // Picking "+ Other…" should reveal a text input for typing a new account name.
    await fixedAccountSelect.selectOption({ value: "__other__" });
    const otherInput = accountRow.locator("input[placeholder='New account name']");
    await expect(otherInput).toBeVisible();
  });
});
