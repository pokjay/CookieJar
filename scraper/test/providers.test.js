// L0 drift guard (#110): every provider CookieJar offers must still be a
// company israeli-bank-scrapers recognizes, with exactly the login fields the
// library expects. Catches breakage on library bumps (the 4.5→6.8 jump in
// #109 changed scraper internals silently).
//
// providers.json is the shared manifest binding this test to the backend:
// tests/test_scraper_keepass.py asserts PROVIDER_SCHEMAS equals the same file,
// so the Python and JS sides can't drift apart either.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CompanyTypes, SCRAPERS } from "israeli-bank-scrapers";

const providers = JSON.parse(
  readFileSync(new URL("../providers.json", import.meta.url), "utf8"),
);

describe("provider manifest ↔ israeli-bank-scrapers", () => {
  test("manifest is non-empty", () => {
    assert.ok(Object.keys(providers).length > 0);
  });

  for (const [companyId, fields] of Object.entries(providers)) {
    test(`${companyId} is a recognized company`, () => {
      assert.ok(
        Object.values(CompanyTypes).includes(companyId),
        `${companyId} missing from CompanyTypes — removed or renamed by the library?`,
      );
    });

    test(`${companyId} login fields match the library's loginFields`, () => {
      const libraryFields = SCRAPERS[companyId]?.loginFields;
      assert.ok(libraryFields, `SCRAPERS has no metadata for ${companyId}`);
      assert.deepEqual(
        [...fields].sort(),
        [...libraryFields].sort(),
        `${companyId}: providers.json says [${fields}] but the library wants [${libraryFields}]`,
      );
    });
  }
});
