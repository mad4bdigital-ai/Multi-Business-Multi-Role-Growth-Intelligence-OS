/**
 * get-live-headers.mjs
 *
 * Reads the live first-row header for each table in TABLE_MAP from the
 * Registry Workbook (and optionally a second spreadsheet for overrides).
 * Outputs JSON: { sheetName: [col1, col2, ...], ... }
 *
 * Usage:
 *   node get-live-headers.mjs
 *   node get-live-headers.mjs --table="Brand Registry"
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { TABLE_MAP } from "./sqlAdapter.js";

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
} catch { /* rely on process.env */ }

const REGISTRY_ID   = process.env.REGISTRY_SPREADSHEET_ID || "";
const ACTIVITY_ID   = process.env.ACTIVITY_SPREADSHEET_ID || REGISTRY_ID;
const EXEC_LOG_ID   = process.env.EXECUTION_LOG_UNIFIED_SPREADSHEET_ID || ACTIVITY_ID;

// Tables that live in a different spreadsheet (mirrors migrate-sheets-to-sql.mjs)
const SPREADSHEET_OVERRIDES = {
  "Execution Log Unified": EXEC_LOG_ID,
};

const args = process.argv.slice(2);
const tableArg = (args.find((a) => a.startsWith("--table=")) || "").replace("--table=", "").trim();
const targetTables = tableArg ? [tableArg] : Object.keys(TABLE_MAP);

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function readHeader(sheets, spreadsheetId, tabName) {
  if (!spreadsheetId) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName.replace(/'/g, "''")}'!1:1`,
    });
    const row = (res.data.values || [])[0] || [];
    return row.map((v) => String(v || "").trim()).filter(Boolean);
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  if (!REGISTRY_ID) {
    console.error("ERROR: REGISTRY_SPREADSHEET_ID not set");
    process.exit(1);
  }

  const sheets = await getSheets();
  const result = {};

  for (const sheetName of targetTables) {
    const spreadsheetId = SPREADSHEET_OVERRIDES[sheetName] || REGISTRY_ID;
    const header = await readHeader(sheets, spreadsheetId, sheetName);
    result[sheetName] = header;
    const label = header && !header.error ? `${header.length} cols` : `ERROR: ${header?.error || "missing spreadsheet ID"}`;
    process.stderr.write(`  ${sheetName.padEnd(42)} ${label}\n`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
