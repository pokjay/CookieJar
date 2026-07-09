import express from "express";
import { createScraper } from "israeli-bank-scrapers";

const app = express();
app.use(express.json({ limit: "1mb" }));

const SCRAPER_TOKEN = process.env.SCRAPER_TOKEN || "";
const PORT = parseInt(process.env.PORT || "3000", 10);

// Safe error types that can be returned without leaking credential or page data.
const SAFE_ERROR_TYPES = new Set([
  "wrong-credentials",
  "timeout",
  "account-blocked",
  "generic-error",
]);

function classifyError(err) {
  if (!err) return "unknown";
  const msg = String(err.message || err).toLowerCase();
  if (msg.includes("credential") || msg.includes("password") || msg.includes("login")) {
    return "wrong-credentials";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("block") || msg.includes("captcha")) {
    return "account-blocked";
  }
  return "generic-error";
}

function authMiddleware(req, res, next) {
  if (!SCRAPER_TOKEN) return next();
  const auth = req.headers["authorization"] || "";
  if (auth !== `Bearer ${SCRAPER_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/scrape", authMiddleware, async (req, res) => {
  const { account, startDate } = req.body;

  if (!account || !account.companyId || !account.credentials) {
    return res.status(400).json({ errorType: "generic-error", transactions: [] });
  }

  const companyId = account.companyId;
  const credentials = account.credentials;

  let scraper;
  try {
    scraper = createScraper({
      companyId,
      startDate: new Date(startDate),
      combineInstallments: false,
      showBrowser: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } catch (err) {
    console.error(`[scrape ${companyId}] createScraper failed:`, err);
    return res.status(400).json({ errorType: "generic-error", transactions: [] });
  }

  let result;
  try {
    result = await scraper.scrape(credentials);
  } catch (err) {
    const errorType = classifyError(err);
    console.error(`[scrape ${companyId}] scrape threw (${errorType}):`, err);
    return res.json({ errorType, transactions: [], accountNumber: null });
  }

  if (!result.success) {
    const errorType = SAFE_ERROR_TYPES.has(result.errorType)
      ? result.errorType
      : "generic-error";
    console.error(
      `[scrape ${companyId}] scrape unsuccessful (errorType=${result.errorType}, errorMessage=${result.errorMessage}) → reported as ${errorType}`,
    );
    return res.json({ errorType, transactions: [], accountNumber: null });
  }

  // Flatten transactions from all accounts in the result.
  const transactions = [];
  let accountNumber = null;
  for (const acct of result.accounts || []) {
    accountNumber = accountNumber || acct.accountNumber;
    for (const tx of acct.txns || []) {
      transactions.push({
        ...tx,
        accountNumber: acct.accountNumber,
      });
    }
  }

  res.json({ transactions, accountNumber, errorType: null });
});

app.listen(PORT, () => {
  console.log(`Scraper sidecar listening on port ${PORT}`);
});
