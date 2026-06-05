import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import * as XLSX from "xlsx";

// Issue #44: the manual-transactions import now accepts .xls / .xlsx in addition
// to .csv. Excel files are parsed client-side and fed through the exact same
// column-mapper → preview → bulk-import pipeline as CSV. These tests cover:
//   1. A single-sheet workbook imports end-to-end, and an Excel date *cell*
//      (numeric serial) survives as an ISO date in the database.
//   2. A multi-sheet workbook surfaces a sheet picker that re-parses on change.

const ACCOUNT = "e2e-xlsx";

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
    await c.query(
      "DELETE FROM moneyman.transactions_manual WHERE account LIKE $1",
      [`${ACCOUNT}%`],
    );
  });
}

const HEADERS = [
  "account",
  "activity_date",
  "charged_currency",
  "original_amount",
  "original_currency",
  "description",
];

// Build an .xlsx buffer from a list of sheets. Cells that are JS Date objects are
// encoded as real Excel date cells (cellDates), which is what proves the numeric
// serial → ISO conversion path on read. Noon anchoring avoids ±TZ day-drift.
function buildXlsx(sheets: { name: string; rows: unknown[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows], { cellDates: true });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Preview cells render as inputs/selects (editable), so assert on their values
// rather than text content — mirrors the helper in the CSV spec.
function cell(page: Page, rowIdx: number, col: string): Locator {
  return page
    .getByTestId(`preview-row-${rowIdx}`)
    .getByTestId(`preview-cell-${col}`)
    .locator("input, select")
    .first();
}

async function uploadXlsx(page: Page, name: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
}

// Shares the moneyman.transactions_manual table with the CSV spec, so force
// serial execution to avoid cleanup races (see manual-transactions-import.spec.ts).
test.describe.configure({ mode: "serial" });

test.describe("Manual Transactions — XLS/XLSX import (#44)", () => {
  test.beforeEach(cleanupAccount);
  test.afterEach(cleanupAccount);

  test("single-sheet workbook imports and an Excel date cell lands as ISO in the DB", async ({
    page,
  }) => {
    // activity_date is a real Date object → Excel date cell → numeric serial.
    // If the serial→ISO conversion regresses, it fails date validation and the
    // row never imports.
    const buffer = buildXlsx([
      {
        name: "Transactions",
        rows: [
          [ACCOUNT, new Date(2026, 4, 1, 12), "ILS", 5000.0, "ILS", "E2E xlsx salary"],
          [ACCOUNT, new Date(2026, 4, 2, 12), "ILS", 45.5, "ILS", "E2E xlsx coffee"],
        ],
      },
    ]);

    await page.goto("/manual-transactions");
    await page.getByRole("button", { name: /file import/i }).click();
    await uploadXlsx(page, "e2e-import.xlsx", buffer);

    // Single sheet → no picker. All required columns present → no mapper.
    await expect(page.getByTestId("sheet-picker")).not.toBeVisible();
    await expect(page.getByText("Map Your Columns")).not.toBeVisible();
    await expect(page.locator("[data-testid^='preview-row-']")).toHaveCount(2);

    await expect(page.getByText("All valid")).toBeVisible();
    const importBtn = page.getByRole("button", { name: /Import 2 transactions?/i });
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect(
      page.getByText(/Successfully imported 2 transactions?/),
    ).toBeVisible();

    const rows = await withPg(async (c) => {
      const result = await c.query<{
        activity_date: string;
        description: string;
        original_amount: string;
      }>(
        `SELECT activity_date::text AS activity_date, description, original_amount
         FROM moneyman.transactions_manual
         WHERE account LIKE $1
         ORDER BY activity_date`,
        [`${ACCOUNT}%`],
      );
      return result.rows;
    });

    expect(rows).toHaveLength(2);
    // The Excel date serial round-tripped to the correct ISO date.
    expect(rows[0].activity_date).toBe("2026-05-01");
    expect(rows[1].activity_date).toBe("2026-05-02");
    expect(rows[0].description).toBe("E2E xlsx salary");
    expect(Number(rows[0].original_amount)).toBeCloseTo(5000.0, 2);
  });

  test("multi-sheet workbook shows a sheet picker that re-parses on change", async ({
    page,
  }) => {
    const buffer = buildXlsx([
      {
        name: "January",
        rows: [
          [ACCOUNT, "2026-01-05", "ILS", 100.0, "ILS", "Jan row one"],
          [ACCOUNT, "2026-01-06", "ILS", 200.0, "ILS", "Jan row two"],
        ],
      },
      {
        name: "February",
        rows: [
          [ACCOUNT, "2026-02-10", "ILS", 300.0, "ILS", "Feb only row"],
        ],
      },
    ]);

    await page.goto("/manual-transactions");
    await page.getByRole("button", { name: /file import/i }).click();
    await uploadXlsx(page, "multi-sheet.xlsx", buffer);

    // Picker appears for a multi-sheet workbook; first sheet is parsed by default.
    const picker = page.getByTestId("sheet-picker");
    await expect(picker).toBeVisible();
    await expect(page.locator("[data-testid^='preview-row-']")).toHaveCount(2);
    await expect(cell(page, 0, "description")).toHaveValue("Jan row one");

    // Switching to the second sheet re-parses → preview reflects the new sheet.
    await picker.selectOption("February");
    await expect(page.locator("[data-testid^='preview-row-']")).toHaveCount(1);
    await expect(cell(page, 0, "description")).toHaveValue("Feb only row");
  });
});
