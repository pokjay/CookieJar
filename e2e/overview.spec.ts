import { test, expect } from "@playwright/test";
// Derived from the mock data generators — regenerate after mock-data changes:
//   USE_MOCK_DATA=true uv run python scripts/generate_e2e_fixtures.py
import EXPECTED from "./fixtures/expected-overview.json";

test.describe("Overview page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("metric-total").waitFor();
  });

  test.describe("Metrics", () => {
    test("total net worth matches mock data", async ({ page }) => {
      await expect(page.getByTestId("metric-total-value")).toHaveText(EXPECTED.total);
    });

    test("per-person cards match mock data", async ({ page }) => {
      for (const [person, amount] of Object.entries(EXPECTED.byPerson)) {
        await expect(page.getByTestId(`metric-${person}-value`)).toHaveText(amount);
      }
    });

    test("YoY delta badges are green and show correct %", async ({ page }) => {
      for (const [person, value] of Object.entries(EXPECTED.delta)) {
        const testid = `delta-${person}`;
        const badge = page.getByTestId(testid).locator("span").first();
        await expect(badge).toContainText(value);
        await expect(badge).toHaveClass(/text-cj-positive/);
      }
    });
  });

  test.describe("Charts", () => {
    test("all four chart containers are visible", async ({ page }) => {
      for (const testid of ["chart-pie", "chart-bars", "chart-area", "chart-category"]) {
        await expect(page.getByTestId(testid)).toBeVisible();
      }
    });

    test("pie chart renders SVG with recharts-pie-sector slices", async ({ page }) => {
      await expect(
        page.locator('[data-testid="chart-pie"] .recharts-pie-sector').first()
      ).toBeVisible();
    });

    test("income and expense bars match mock data", async ({ page }) => {
      const chartBars = page.getByTestId("chart-bars");
      const bars = chartBars.locator(".recharts-bar-rectangle");

      await bars.first().hover();
      await expect(chartBars.locator(".recharts-tooltip-wrapper")).toContainText(EXPECTED.avgMonthlyIncome);

      await bars.nth(1).hover();
      await expect(chartBars.locator(".recharts-tooltip-wrapper")).toContainText(EXPECTED.avgMonthlyExpense);
    });
  });

  test.describe("Year selector", () => {
    test("defaults to the latest mock-data year", async ({ page }) => {
      await expect(page.getByTestId("year-selector")).toHaveValue(EXPECTED.currentYear);
    });

    test("available options cover all mock-data years", async ({ page }) => {
      const selector = page.getByTestId("year-selector");
      for (const year of EXPECTED.availableYears) {
        await expect(selector.locator(`option[value="${year}"]`)).toBeAttached();
      }
    });

    test("switching to 2023 updates income/expense chart title", async ({ page }) => {
      await page.getByTestId("year-selector").selectOption("2023");
      await expect(page.getByTestId("chart-bars").locator("h3")).toContainText("2023");
    });
  });

  test.describe("Person filter (area chart)", () => {
    test("both persons checked by default", async ({ page }) => {
      await expect(page.getByTestId("person-checkbox-Gomez")).toBeChecked();
      await expect(page.getByTestId("person-checkbox-Morticia")).toBeChecked();
    });

    test("unchecking Morticia: chart still renders (Gomez only)", async ({ page }) => {
      await page.getByTestId("person-checkbox-Morticia").uncheck();
      await expect(page.getByTestId("chart-area")).toBeVisible();
    });

    test("unchecking all: chart renders empty gracefully", async ({ page }) => {
      await page.getByTestId("person-checkbox-Gomez").uncheck();
      await page.getByTestId("person-checkbox-Morticia").uncheck();
      await expect(page.getByTestId("chart-area")).toBeVisible();
    });
  });

  test.describe("Cash flow table", () => {
    test("household table is visible", async ({ page }) => {
      await expect(page.getByTestId("cashflow-table-Household")).toBeVisible();
    });

    test("year rows present for all mock-data years", async ({ page }) => {
      for (const year of EXPECTED.availableYears) {
        await expect(page.getByTestId(`cashflow-year-${year}`)).toBeVisible();
      }
    });

    test("clicking a year row expands to show monthly rows", async ({ page }) => {
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).toBeVisible();
    });

    test("clicking again collapses monthly rows", async ({ page }) => {
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).toBeVisible();
      await page.getByTestId(`cashflow-year-${EXPECTED.currentYear}`).click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).not.toBeVisible();
    });

    test("selecting a person in Individual selector shows their table", async ({ page }) => {
      // There are multiple person-selector elements; the last one is for Individual cash flow
      await page.getByTestId("person-selector").last().selectOption("Gomez");
      await expect(page.getByTestId("cashflow-table-Gomez")).toBeVisible();
    });
  });
});
