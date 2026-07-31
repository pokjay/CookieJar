import { test, expect } from "@playwright/test";
// Derived from the mock data generators — regenerate after mock-data changes:
//   USE_MOCK_DATA=true uv run python scripts/generate_e2e_fixtures.py
import EXPECTED from "./fixtures/expected-overview.json";

test.describe("Overview page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("metric-total-value").waitFor();
  });

  test.describe("Net worth hero", () => {
    test("total net worth matches mock data", async ({ page }) => {
      await expect(page.getByTestId("metric-total-value")).toHaveText(EXPECTED.total);
    });

    test("chart renders a line for the default range", async ({ page }) => {
      await expect(page.getByTestId("chart-networth").locator("svg path").first()).toBeVisible();
    });

    test("switching range keeps the same latest net worth", async ({ page }) => {
      await page.getByRole("button", { name: "6M", exact: true }).click();
      await expect(page.getByTestId("metric-total-value")).toHaveText(EXPECTED.total);
    });

    test("'By type' mode stacks a band per account type", async ({ page }) => {
      const paths = page.getByTestId("chart-networth").locator("svg path");
      const before = await paths.count();
      await page
        .getByRole("group", { name: "Net worth view" })
        .getByRole("button", { name: "By type" })
        .click();
      // Every type contributes a filled band plus its own top edge.
      await expect(paths).toHaveCount(before + EXPECTED.accountTypes.length * 2 - 2);
      for (const type of EXPECTED.accountTypes) {
        await expect(page.getByTestId(`chart-legend-${type}`)).toBeVisible();
      }
    });
  });

  test.describe("Accounts by person", () => {
    test("each person has a group with their total", async ({ page }) => {
      for (const [person, amount] of Object.entries(EXPECTED.byPerson)) {
        await expect(page.getByTestId(`account-group-${person}-total`)).toHaveText(amount);
      }
    });

    test("expanding a person reveals their accounts", async ({ page }) => {
      const group = page.getByTestId("account-group-Morticia");
      await expect(group).toHaveAttribute("aria-expanded", "false");
      await group.click();
      await expect(group).toHaveAttribute("aria-expanded", "true");
    });

    test("rows are grouped by account type by default", async ({ page }) => {
      await page.getByTestId("account-group-Morticia").click();
      await expect(page.getByTestId("account-row-Morticia::Pension")).toBeVisible();
      // Per-provider rows ("Pension · Migdal") only appear in the by-account view.
      await expect(page.getByTestId(/^account-row-Morticia::acct-/)).toHaveCount(0);
    });

    test("switching to 'By account' restores the per-provider rows", async ({ page }) => {
      await page.getByTestId("account-group-Morticia").click();
      await page
        .getByRole("group", { name: "Accounts grouping" })
        .getByRole("button", { name: "By account" })
        .click();
      await expect(page.getByTestId("account-row-Morticia::Pension")).toHaveCount(0);
      await expect(
        page.getByTestId(/^account-row-Morticia::acct-/).filter({ hasText: "Pension · " }).first()
      ).toBeVisible();
    });
  });

  test.describe("Cash flow ledger", () => {
    test("ledger is visible", async ({ page }) => {
      await expect(page.getByTestId("cashflow-ledger")).toBeVisible();
    });

    test("year rows present for all mock-data years", async ({ page }) => {
      for (const year of EXPECTED.availableYears) {
        await expect(page.getByTestId(`cashflow-year-${year}`)).toBeVisible();
      }
    });

    test("clicking a year row expands to show monthly rows", async ({ page }) => {
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.getByTestId("cashflow-month-row").first()).toBeVisible();
    });

    test("clicking again collapses monthly rows", async ({ page }) => {
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.getByTestId("cashflow-month-row").first()).toBeVisible();
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.getByTestId("cashflow-month-row")).toHaveCount(0);
    });

    test("scoping to a person reloads the ledger", async ({ page }) => {
      await page.getByRole("group", { name: "Cash flow scope" }).getByRole("button", { name: "Gomez" }).click();
      await expect(page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`)).toBeVisible();
    });
  });
});
