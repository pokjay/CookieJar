// Excel (.xls / .xlsx) parsing for the manual-transactions import flow.
//
// SheetJS is large (~600KB), so it is lazy-loaded via `await import("xlsx")` and
// only pulled into the bundle when a user actually uploads a workbook. The
// `import type` below is erased at compile time and does NOT defeat that.
//
// `sheetToRows` produces the exact same `Record<string, string>[]` shape that
// `parseCsv` returns, so the entire downstream pipeline (column mapper,
// validation, preview/edit, bulk import) works unchanged.

import type { WorkBook } from "xlsx";

export async function readWorkbook(buf: ArrayBuffer): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  // cellDates: true makes date-formatted cells come back as JS Date objects
  // instead of raw Excel numeric serials.
  return XLSX.read(buf, { type: "array", cellDates: true });
}

export function getSheetNames(wb: WorkBook): string[] {
  return wb.SheetNames;
}

export async function sheetToRows(
  wb: WorkBook,
  sheetName: string,
): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx"); // memoized after the first call — cheap
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  // header: 1 -> array-of-arrays (first row = headers, rest = values), mirroring
  // how parseCsv treats the first line. raw: true keeps cell values as their
  // native JS type so we can stringify them ourselves — using the display format
  // could inject currency symbols / grouping that break amount validation.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: "",
  });
  if (aoa.length < 2) return []; // mirrors parseCsv's lines.length < 2 guard
  const headers = (aoa[0] as unknown[]).map((h) => stringifyCell(h).trim());
  return aoa.slice(1).map((rowArr) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = stringifyCell((rowArr as unknown[])[i]);
    });
    return obj;
  });
}

function stringifyCell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // Date-only ISO (YYYY-MM-DD) — passes the existing tryParseDate / date
    // validation and matches what activity_date / charged_date expect.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // String(n) emits no grouping separators and avoids exponent notation below
    // 1e21; guard larger values (e.g. big numeric IDs) to keep them readable.
    if (Math.abs(v) >= 1e21) {
      return v.toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 20,
      });
    }
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}
