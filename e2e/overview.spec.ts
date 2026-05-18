import { test, expect } from "@playwright/test";

const EXPECTED = {
  total:         "₪2,052,529",
  gomez:         "₪1,113,309",
  morticia:      "₪939,220",
  deltaOverall:  "+8.8%",
  deltaGomez:    "+7.1%",
  deltaMorticia: "+10.8%",
  income2025:    "₪63,645",
  expense2025:   "₪43,003",
};

test.describe("Overview page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("metric-total").waitFor();
  });

  test.describe("Metrics", () => {
    test("total net worth shows ₪2,052,529", async ({ page }) => {
      await expect(page.getByTestId("metric-total-value")).toHaveText(EXPECTED.total);
    });

    test("Gomez card shows ₪1,113,309", async ({ page }) => {
      await expect(page.getByTestId("metric-Gomez-value")).toHaveText(EXPECTED.gomez);
    });

    test("Morticia card shows ₪939,220", async ({ page }) => {
      await expect(page.getByTestId("metric-Morticia-value")).toHaveText(EXPECTED.morticia);
    });

    test("YoY delta badges are green and show correct %", async ({ page }) => {
      const cases = [
        ["delta-Overall", EXPECTED.deltaOverall],
        ["delta-Gomez", EXPECTED.deltaGomez],
        ["delta-Morticia", EXPECTED.deltaMorticia],
      ] as const;
      for (const [testid, value] of cases) {
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

    test("income bar shows ₪63,645 and expense bar shows ₪43,003", async ({ page }) => {
      const chartBars = page.getByTestId("chart-bars");
      const bars = chartBars.locator(".recharts-bar-rectangle");

      await bars.first().hover();
      await expect(chartBars.locator(".recharts-tooltip-wrapper")).toContainText(EXPECTED.income2025);

      await bars.nth(1).hover();
      await expect(chartBars.locator(".recharts-tooltip-wrapper")).toContainText(EXPECTED.expense2025);
    });
  });

  test.describe("Year selector", () => {
    test("defaults to 2025", async ({ page }) => {
      await expect(page.getByTestId("year-selector")).toHaveValue("2025");
    });

    test("available options include 2022, 2023, 2024, 2025", async ({ page }) => {
      const selector = page.getByTestId("year-selector");
      for (const year of ["2022", "2023", "2024", "2025"]) {
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

    test("year rows present for 2022–2025", async ({ page }) => {
      for (const year of [2022, 2023, 2024, 2025]) {
        await expect(page.getByTestId(`cashflow-year-${year}`)).toBeVisible();
      }
    });

    test("clicking a year row expands to show monthly rows", async ({ page }) => {
      await page.getByTestId("cashflow-year-2025").click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).toBeVisible();
    });

    test("clicking again collapses monthly rows", async ({ page }) => {
      await page.getByTestId("cashflow-year-2025").click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).toBeVisible();
      await page.getByTestId("cashflow-year-2025").click();
      await expect(page.locator('[data-testid="cashflow-month-row"]').first()).not.toBeVisible();
    });

    test("selecting a person in Individual selector shows their table", async ({ page }) => {
      // There are multiple person-selector elements; the last one is for Individual cash flow
      await page.getByTestId("person-selector").last().selectOption("Gomez");
      await expect(page.getByTestId("cashflow-table-Gomez")).toBeVisible();
    });
  });
});
