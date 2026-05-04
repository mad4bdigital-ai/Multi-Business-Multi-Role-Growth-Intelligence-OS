/**
 * migrate-sheets-to-sql.mjs
 * One-time seed: reads all data from Google Sheets → inserts into Hostinger MySQL.
 *
 * Usage:
 *   node migrate-sheets-to-sql.mjs                   # migrate all 15 tables
 *   node migrate-sheets-to-sql.mjs --table="Brand Registry"
 *   node migrate-sheets-to-sql.mjs --truncate         # clear tables before insert
 *   node migrate-sheets-to-sql.mjs --dry-run          # read Sheets only, no SQL writes
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { bulkInsertRows, clearTable, TABLE_MAP, SHEET_COLUMNS } from "./sqlAdapter.js";
import { getPool } from "./db.js";

// ── Load .env manually (dotenv not installed) ──────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found — rely on process.env */ }

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const TRUNCATE = args.includes("--truncate");
const IGNORE   = args.includes("--ignore");
const tableArg = (args.find((a) => a.startsWith("--table=")) || "").replace("--table=", "").trim();
const TARGET_TABLES = tableArg ? [tableArg] : Object.keys(TABLE_MAP);

// ── Spreadsheet ID mapping ─────────────────────────────────────────────────────
const REGISTRY_ID  = process.env.REGISTRY_SPREADSHEET_ID  || "";
const ACTIVITY_ID  = process.env.ACTIVITY_SPREADSHEET_ID  || REGISTRY_ID;
const EXEC_LOG_ID  = process.env.EXECUTION_LOG_UNIFIED_SPREADSHEET_ID || ACTIVITY_ID;
const JSON_ASSET_ID = process.env.JSON_ASSET_REGISTRY_SPREADSHEET_ID  || REGISTRY_ID;

const SHEET_SPREADSHEET_MAP = {
  "Execution Log Unified": EXEC_LOG_ID,
  "JSON Asset Registry":   JSON_ASSET_ID,
};

function spreadsheetIdFor(sheetName) {
  return SHEET_SPREADSHEET_MAP[sheetName] || REGISTRY_ID;
}

// ── Google Sheets auth ─────────────────────────────────────────────────────────
async function getSheets() {
  // Prefer saved OAuth token (from auth-setup.mjs) over ADC
  const tokenPath   = resolve(__dirname, "google-oauth-token.json");
  const secretsPath = resolve(__dirname, "../secrets/oauth-client.json");
  try {
    const tokens  = JSON.parse(readFileSync(tokenPath, "utf8"));
    const secrets = JSON.parse(readFileSync(secretsPath, "utf8")).installed;
    const oauth2  = new google.auth.OAuth2(
      secrets.client_id, secrets.client_secret, "http://localhost:8765"
    );
    oauth2.setCredentials(tokens);
    return google.sheets({ version: "v4", auth: oauth2 });
  } catch { /* no saved token — fall through to ADC */ }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ── Read one sheet ─────────────────────────────────────────────────────────────
async function readSheetRows(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AZ`,
  });
  const values = response.data.values || [];
  if (!values.length) return [];

  const header = values[0].map((v) => String(v || "").trim());
  return values.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const record = {};
      header.forEach((key, idx) => {
        if (key) record[key] = String(row[idx] ?? "");
      });
      return record;
    });
}

// ── Migrate one table ──────────────────────────────────────────────────────────
async function migrateTable(sheets, sheetName) {
  const spreadsheetId = spreadsheetIdFor(sheetName);
  if (!spreadsheetId) {
    return { sheetName, status: "skipped", reason: "no spreadsheet ID" };
  }

  let sheetRows;
  try {
    sheetRows = await readSheetRows(sheets, spreadsheetId, sheetName);
  } catch (err) {
    return { sheetName, status: "error", reason: `Sheets read failed: ${err.message}` };
  }

  if (sheetRows.length === 0) {
    return { sheetName, status: "empty", rows: 0 };
  }

  if (DRY_RUN) {
    return { sheetName, status: "dry-run", rows: sheetRows.length };
  }

  if (TRUNCATE) {
    try {
      await clearTable(sheetName);
    } catch (err) {
      return { sheetName, status: "error", reason: `TRUNCATE failed: ${err.message}` };
    }
  }

  try {
    const inserted = await bulkInsertRows(sheetName, sheetRows, { ignore: IGNORE });
    return { sheetName, status: "ok", rows: inserted };
  } catch (err) {
    return { sheetName, status: "error", reason: `SQL insert failed: ${err.message}` };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━ Growth OS — Sheets → MySQL Migrator ━━━");
  console.log(`Mode   : ${DRY_RUN ? "DRY RUN (no writes)" : TRUNCATE ? "TRUNCATE + INSERT" : "INSERT (append)"}`);
  console.log(`Tables : ${TARGET_TABLES.length === Object.keys(TABLE_MAP).length ? "all 15" : TARGET_TABLES.join(", ")}`);
  console.log(`DB     : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log("");

  if (!REGISTRY_ID) {
    console.error("ERROR: REGISTRY_SPREADSHEET_ID not set in .env — cannot read from Sheets.");
    process.exit(1);
  }

  // Verify DB connection first
  try {
    const conn = await getPool().getConnection();
    await conn.ping();
    conn.release();
    console.log("✓ MySQL connection OK");
  } catch (err) {
    console.error("✗ MySQL connection failed:", err.message);
    process.exit(1);
  }

  // Authenticate with Google
  let sheets;
  try {
    sheets = await getSheets();
    console.log("✓ Google Sheets auth OK");
  } catch (err) {
    console.error("✗ Google Sheets auth failed:", err.message);
    console.error("  Ensure GOOGLE_APPLICATION_CREDENTIALS is set.");
    process.exit(1);
  }

  console.log("");

  // Migrate each table
  const results = [];
  for (const sheetName of TARGET_TABLES) {
    process.stdout.write(`  ${sheetName.padEnd(40)} ...`);
    const result = await migrateTable(sheets, sheetName);
    results.push(result);

    const icon = result.status === "ok" ? "✓" :
                 result.status === "dry-run" ? "~" :
                 result.status === "empty" ? "○" :
                 result.status === "skipped" ? "–" : "✗";

    const detail = result.status === "error" ? result.reason
                 : result.rows != null ? `${result.rows} rows`
                 : result.reason || "";

    console.log(` ${icon}  ${detail}`);
  }

  // Summary
  const ok      = results.filter((r) => r.status === "ok").length;
  const empty   = results.filter((r) => r.status === "empty").length;
  const errors  = results.filter((r) => r.status === "error");
  const dryRuns = results.filter((r) => r.status === "dry-run").length;
  const total   = results.filter((r) => r.rows != null).reduce((s, r) => s + (r.rows || 0), 0);

  console.log("");
  console.log("━━━ Summary ━━━");
  if (DRY_RUN) console.log(`  Would migrate : ${total} rows across ${dryRuns} tables`);
  else          console.log(`  Migrated      : ${total} rows — ${ok} tables OK, ${empty} empty, ${errors.length} errors`);

  if (errors.length) {
    console.log("\n  Errors:");
    errors.forEach((e) => console.log(`    ✗ ${e.sheetName}: ${e.reason}`));
  }

  await getPool().end();
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
