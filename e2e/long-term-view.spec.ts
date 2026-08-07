import { test, expect } from "@playwright/test";

/**
 * The long-term view's interactions (hover readout, average line, click-to-jump)
 * are only reachable through the rendered chart, so they are covered here rather
 * than in the Python unit layer.
 *
 * Assertions stay shape-based rather than value-based: the mock generators decide
 * how much spend lands in each month, and pinning amounts here would make the
 * spec fail whenever those change for unrelated reasons.
 */
test.describe("Transactions — long-term view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions");
    await page.getByTestId("month-label").waitFor();
    await page.getByTestId("long-term-toggle").click();
    await page.getByTestId("long-term-bars").waitFor();
  });

  test("renders 24 bars and a labelled average line", async ({ page }) => {
    await expect(page.getByTestId("long-term-bars").getByRole("button")).toHaveCount(24);
    await expect(page.getByTestId("long-term-average")).toBeVisible();
    await expect(page.getByTestId("long-term-average")).toContainText("avg");
  });

  test("hovering a bar shows its amount and month", async ({ page }) => {
    const bars = page.getByTestId("long-term-bars").getByRole("button");
    await expect(page.getByTestId("long-term-tooltip")).toBeHidden();

    const last = bars.last();
    const label = await last.getAttribute("aria-label");
    // aria-label is "<Mon YYYY>: <amount> — <state>"; the tooltip shows the same pair.
    const month = label!.split(":")[0];

    await last.hover();
    const tooltip = page.getByTestId("long-term-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(month);
  });

  test("keyboard focus surfaces the same readout as hover", async ({ page }) => {
    const first = page.getByTestId("long-term-bars").getByRole("button").first();
    await first.focus();
    await expect(page.getByTestId("long-term-tooltip")).toBeVisible();
  });

  test("clicking a bar selects that month", async ({ page }) => {
    const monthLabel = page.getByTestId("month-label");
    const before = await monthLabel.textContent();

    // The newest month is the one already shown, so it is inert by design —
    // pick the most recent bar that is actually actionable.
    const actionable = page
      .getByTestId("long-term-bars")
      .getByRole("button")
      .and(page.locator('[aria-disabled="false"]'));
    await expect(actionable.first()).toBeAttached();

    const target = actionable.last();
    const label = await target.getAttribute("aria-label");
    const month = label!.split(":")[0];

    await target.click();
    await expect(monthLabel).toHaveText(month);
    expect(month).not.toBe(before);
  });

  test("the selected month's bar is not actionable", async ({ page }) => {
    const shown = await page.getByTestId("month-label").textContent();
    const current = page
      .getByTestId("long-term-bars")
      .getByRole("button")
      .and(page.locator(`[aria-label^="${shown}:"]`));
    await expect(current).toHaveAttribute("aria-disabled", "true");
    await expect(current).toHaveAttribute("aria-label", /currently shown/);
  });
});
