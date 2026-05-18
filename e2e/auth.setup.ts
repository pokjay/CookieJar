import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";

const authFile = path.join(__dirname, ".auth/session.json");

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.goto("/login");
  await page.locator('[name="password"]').fill(process.env.AUTH_PASSWORD ?? "");
  await page.locator('[type="submit"]').click();
  await page.waitForURL("/");
  await page.context().storageState({ path: authFile });
});
