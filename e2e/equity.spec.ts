import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

// Equity page: grants are stored in moneyman.equity_grants, edited inline, and
// kept out of net worth. Exercises add → edit → reload → computed values →
// delete against the real backend + DB, verifying persistence in Postgres.

const NAME = "E2E hire grant";

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

async function cleanup() {
  await withPg((c) => c.query("DELETE FROM moneyman.equity_grants WHERE name LIKE 'E2E%'"));
}

async function dbRows() {
  return withPg(async (c) => {
    const res = await c.query(
      `SELECT name, to_char(grant_date, 'YYYY-MM-DD') AS grant_date,
              shares::float8 AS shares, strike::float8 AS strike,
              vesting_years::float8 AS vesting_years, cliff_months
         FROM moneyman.equity_grants WHERE name LIKE 'E2E%'`
    );
    return res.rows;
  });
}

async function openEquity(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/equity/grants") && r.request().method() === "GET"),
    page.goto("/equity"),
  ]);
  await expect(page.getByRole("heading", { name: "Equity" })).toBeVisible();
}

const savedPut = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes("/api/equity/grants/") && r.request().method() === "PUT" && r.ok()
  );

// Tests share the e2e-owned rows in moneyman.equity_grants (add → edit →
// delete), so they must run in order. Other spec files keep parallelism.
test.describe.configure({ mode: "serial" });

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("adding and editing a grant persists it to the database", async ({ page }) => {
  await openEquity(page);
  const netWorthBefore = (await (await page.request.get("/api/overview/summary")).json()).total;

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/equity/grants") && r.request().method() === "POST" && r.status() === 201
    ),
    page.getByRole("button", { name: /add grant/i }).click(),
  ]);

  // The new row's name field is focused with its text selected; typing replaces it.
  const name = page.getByLabel("Grant name").last();
  await expect(name).toBeFocused();
  await name.fill(NAME);
  // Labels follow the live name, so these resolve to the new row only.
  await page.getByLabel(`${NAME} grant date`).fill("2020-01-15");
  await page.getByLabel(`${NAME} shares`).fill("1000");
  await page.getByLabel(`${NAME} strike price`).fill("10");
  await Promise.all([savedPut(page), page.getByLabel(`${NAME} strike price`).blur()]);

  await expect.poll(dbRows).toEqual([
    {
      name: NAME,
      grant_date: "2020-01-15",
      shares: 1000,
      strike: 10,
      vesting_years: 4,
      cliff_months: 12,
    },
  ]);

  // View-only: grants never move the net-worth total.
  const netWorthAfter = (await (await page.request.get("/api/overview/summary")).json()).total;
  expect(netWorthAfter).toBe(netWorthBefore);

  // Survives a reload — it came back from the DB, not local state.
  await openEquity(page);
  await expect(page.getByLabel(`${NAME} shares`)).toHaveValue("1000");
});

test("a grant's payout is shares × (price − strike)", async ({ page }) => {
  await openEquity(page);
  await page.getByLabel("Price", { exact: true }).fill("30");

  // Granted 2020 on a 4-year schedule → fully vested today.
  const row = page.locator("tr", { has: page.getByLabel(`${NAME} shares`) });
  await expect(row).toContainText("100%");
  // 1,000 × (30 − 10), both "value now" and "value at full".
  await expect(row.getByText("$20,000", { exact: true })).toHaveCount(2);

  // Below the strike the payout is zero, not negative.
  await page.getByLabel("Price", { exact: true }).fill("5");
  await expect(row.getByText("$0", { exact: true })).toHaveCount(2);
});

test("deleting a grant removes it from the database", async ({ page }) => {
  await openEquity(page);
  await page.getByRole("button", { name: `Delete ${NAME}` }).click();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/equity/grants/") && r.request().method() === "DELETE"),
    page.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);

  await expect(page.getByLabel(`${NAME} shares`)).toHaveCount(0);
  await expect.poll(dbRows).toEqual([]);
});
