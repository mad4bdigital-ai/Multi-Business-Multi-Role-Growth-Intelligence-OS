/**
 * audit-migration-validation.mjs
 *
 * Data migration validation audit:
 * Compares every mapped table (TABLE_MAP) between MySQL DB and source Google Sheets.
 * Also checks platform-only tables for row counts.
 *
 * Usage: node audit-migration-validation.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
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
} catch { /* ignore */ }

// ── TABLE_MAP (from sqlAdapter.js) ───────────────────────────────────────────
const TABLE_MAP = {
  "Brand Registry":                     "brands",
  "Brand Core Registry":                "brand_core",
  "Actions Registry":                   "actions",
  "API Actions Endpoint Registry":      "endpoints",
  "Execution Policy Registry":          "execution_policies",
  "Hosting Account Registry":           "hosting_accounts",
  "Site Runtime Inventory Registry":    "site_runtime_inventory",
  "Site Settings Inventory Registry":   "site_settings_inventory",
  "Plugin Inventory Registry":          "plugins",
  "Task Routes":                        "task_routes",
  "Workflow Registry":                  "workflows",
  "Registry Surfaces Catalog":          "registry_surfaces_catalog",
  "Validation & Repair Registry":       "validation_repair",
  "JSON Asset Registry":                "json_assets",
  "Execution Log Unified":              "execution_log",
};

// Natural keys per sheet (for key-level comparison)
const NATURAL_KEYS = {
  "Brand Registry":                   ["target_key"],
  "Brand Core Registry":              ["brand_key"],
  "Actions Registry":                 ["action_key"],
  "API Actions Endpoint Registry":    ["endpoint_id"],
  "Execution Policy Registry":        ["policy_group", "policy_key"],
  "Hosting Account Registry":         ["hosting_account_key"],
  "Site Runtime Inventory Registry":  ["target_key"],
  "Site Settings Inventory Registry": ["target_key"],
  "Plugin Inventory Registry":        ["target_key"],
  "Task Routes":                      ["route_id"],
  "Workflow Registry":                ["Workflow ID"],
  "Registry Surfaces Catalog":        ["surface_id"],
  "Validation & Repair Registry":     ["validation_id"],
  "JSON Asset Registry":              ["asset_id"],
  "Execution Log Unified":            null,
};

// Platform-only tables (no Sheets source)
const PLATFORM_ONLY_TABLES = [
  "tenants", "users", "memberships", "logic_packs",
  "workflow_runs", "step_runs"
];

// Spreadsheet IDs
const REGISTRY_ID = process.env.REGISTRY_SPREADSHEET_ID || "1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o";
const ACTIVITY_ID = process.env.ACTIVITY_SPREADSHEET_ID || "1Ksge5czL99W7nwm8XxNT9X34mBoxWcl4gPOBbgamNDw";

const SHEET_SPREADSHEET_MAP = {
  "Execution Log Unified": ACTIVITY_ID,
  "JSON Asset Registry":   REGISTRY_ID,
};

function spreadsheetIdFor(sheetName) {
  return SHEET_SPREADSHEET_MAP[sheetName] || REGISTRY_ID;
}

// ── Google Sheets auth ────────────────────────────────────────────────────────
async function getSheets() {
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
  } catch (err) {
    console.error("OAuth token load failed:", err.message, "— trying ADC");
  }
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ── Read sheet rows ───────────────────────────────────────────────────────────
async function readSheetRows(sheets, spreadsheetId, sheetName) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A:AZ`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = res.data.values || [];
  if (!values.length) return { rows: [], header: [] };

  const header = values[0].map((v) => String(v || "").trim());
  const rows = values.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const record = {};
      header.forEach((key, idx) => {
        if (key) record[key] = String(row[idx] ?? "").trim();
      });
      return record;
    });

  return { rows, header };
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getPool() {
  return mysql.createPool({
    host:     process.env.DB_HOST     || "srv1343.hstgr.io",
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME     || "u338416126_growthOS",
    user:     process.env.DB_USER     || "u338416126_growthOS",
    password: process.env.DB_PASSWORD || "Mad4b@147258369",
    waitForConnections: true,
    connectionLimit: 5,
    timezone: "Z",
  });
}

async function dbCount(pool, table) {
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
    return rows[0].cnt;
  } catch (err) {
    return { error: err.message };
  }
}

async function dbGetKeys(pool, table, columns, limit = null) {
  try {
    const cols = columns.map((c) => `\`${c}\``).join(", ");
    const limitClause = limit ? ` LIMIT ${limit}` : "";
    const [rows] = await pool.query(
      `SELECT ${cols} FROM \`${table}\` ORDER BY id${limitClause}`
    );
    return rows;
  } catch (err) {
    return { error: err.message };
  }
}

async function dbGetAllKeys(pool, table, column) {
  try {
    const [rows] = await pool.query(
      `SELECT \`${column}\` AS key_val FROM \`${table}\` WHERE \`${column}\` IS NOT NULL AND \`${column}\` != '' ORDER BY id`
    );
    return rows.map((r) => String(r.key_val).trim());
  } catch (err) {
    return { error: err.message };
  }
}

// Map sheet column name → SQL column name (toSqlCol from sqlAdapter)
function toSqlCol(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Main audit ────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━ Migration Validation Audit — Growth OS ━━━");
  console.log(`DB: ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log(`Registry Sheet ID: ${REGISTRY_ID}`);
  console.log(`Activity Sheet ID: ${ACTIVITY_ID}`);
  console.log("");

  const pool = await getPool();

  // Verify DB connection
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log("MySQL connection: OK");
  } catch (err) {
    console.error("MySQL connection FAILED:", err.message);
    process.exit(1);
  }

  // Google Sheets
  let sheets;
  try {
    sheets = await getSheets();
    // Quick connectivity test
    await sheets.spreadsheets.values.get({
      spreadsheetId: REGISTRY_ID,
      range: "Brand Registry!A1:A1",
    });
    console.log("Google Sheets auth: OK");
  } catch (err) {
    console.error("Google Sheets auth FAILED:", err.message);
    process.exit(1);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("=== MIGRATION VALIDATION REPORT ===");
  console.log("=".repeat(60));
  console.log("");

  const results = [];

  // ── Check each mapped table ───────────────────────────────────────────────
  for (const [sheetName, dbTable] of Object.entries(TABLE_MAP)) {
    const result = { sheetName, dbTable };
    const spreadsheetId = spreadsheetIdFor(sheetName);
    const keyFields = NATURAL_KEYS[sheetName];

    // DB count
    const dbRowCount = await dbCount(pool, dbTable);
    result.dbRows = typeof dbRowCount === "object" ? 0 : dbRowCount;
    result.dbError = typeof dbRowCount === "object" ? dbRowCount.error : null;

    // Sheets rows
    let sheetRows = [];
    let sheetHeader = [];
    let sheetsError = null;
    try {
      const fetched = await readSheetRows(sheets, spreadsheetId, sheetName);
      sheetRows = fetched.rows;
      sheetHeader = fetched.header;
    } catch (err) {
      sheetsError = err.message;
    }
    result.sheetRows = sheetRows.length;
    result.sheetsError = sheetsError;
    result.sheetHeader = sheetHeader;

    // Count match check
    result.countMatch = !sheetsError && !result.dbError && result.dbRows === result.sheetRows;

    // Key-level comparison (skip for append-only / error cases)
    result.missingInDb = [];
    result.extraInDb = [];
    result.keyMismatch = false;

    if (!sheetsError && !result.dbError && keyFields !== null && keyFields) {
      // Build set of sheet keys
      const sheetKeys = new Set();
      for (const row of sheetRows) {
        const key = keyFields.map((f) => String(row[f] ?? "").trim()).join("||");
        if (key.replace(/\|/g, "").trim()) sheetKeys.add(key);
      }

      // Build set of DB keys
      const primaryKeyField = toSqlCol(keyFields[0]);
      let dbKeys = new Set();

      if (keyFields.length === 1) {
        const dbKeyArr = await dbGetAllKeys(pool, dbTable, primaryKeyField);
        if (!Array.isArray(dbKeyArr)) {
          result.keyError = dbKeyArr.error;
        } else {
          for (const k of dbKeyArr) dbKeys.add(k);
        }
      } else {
        // Composite key
        const sqlCols = keyFields.map(toSqlCol);
        const dbKeyRows = await dbGetKeys(pool, dbTable, sqlCols);
        if (!Array.isArray(dbKeyRows)) {
          result.keyError = dbKeyRows.error;
        } else {
          for (const row of dbKeyRows) {
            const key = sqlCols.map((c) => String(row[c] ?? "").trim()).join("||");
            dbKeys.add(key);
          }
        }
      }

      if (!result.keyError) {
        // Missing in DB: in Sheets but not in DB
        for (const k of sheetKeys) {
          if (!dbKeys.has(k)) result.missingInDb.push(k);
        }
        // Extra in DB: in DB but not in Sheets
        for (const k of dbKeys) {
          if (!sheetKeys.has(k)) result.extraInDb.push(k);
        }
        result.keyMismatch = result.missingInDb.length > 0 || result.extraInDb.length > 0;
      }
    }

    results.push(result);

    // Print result
    const status = sheetsError ? "SHEETS_UNREADABLE"
                 : result.dbError ? "DB_ERROR"
                 : result.countMatch && !result.keyMismatch ? "MATCH"
                 : result.countMatch ? "COUNT_MATCH_KEY_MISMATCH"
                 : "MISMATCH";

    console.log(`TABLE: ${dbTable}`);
    console.log(`  Sheets tab:   "${sheetName}"`);
    console.log(`  Sheets rows:  ${sheetsError ? "ERROR" : result.sheetRows}`);
    console.log(`  DB rows:      ${result.dbError ? "ERROR" : result.dbRows}`);
    console.log(`  Status:       ${status}`);

    if (sheetsError) {
      console.log(`  Sheets error: ${sheetsError}`);
    }
    if (result.dbError) {
      console.log(`  DB error:     ${result.dbError}`);
    }
    if (result.keyError) {
      console.log(`  Key error:    ${result.keyError}`);
    }
    if (result.missingInDb.length > 0) {
      const shown = result.missingInDb.slice(0, 20);
      console.log(`  Missing in DB (${result.missingInDb.length} total): ${shown.join(", ")}${result.missingInDb.length > 20 ? " ..." : ""}`);
    }
    if (result.extraInDb.length > 0) {
      const shown = result.extraInDb.slice(0, 20);
      console.log(`  Extra in DB (${result.extraInDb.length} total):   ${shown.join(", ")}${result.extraInDb.length > 20 ? " ..." : ""}`);
    }
    console.log("");
  }

  // ── Platform-only table counts ───────────────────────────────────────────
  console.log("─".repeat(60));
  console.log("PLATFORM-ONLY TABLES (no Sheets source):");
  console.log("");
  const platformResults = [];
  for (const table of PLATFORM_ONLY_TABLES) {
    const cnt = await dbCount(pool, table);
    platformResults.push({ table, count: cnt });
    const display = typeof cnt === "object" ? `ERROR: ${cnt.error}` : cnt;
    console.log(`  ${table.padEnd(30)} ${display} rows`);
  }

  // ── Also check logic_definitions since it was mentioned ──────────────────
  const logicTables = ["logic_definitions", "connected_systems"];
  for (const table of logicTables) {
    const cnt = await dbCount(pool, table);
    const display = typeof cnt === "object" ? `ERROR: ${cnt.error}` : cnt;
    console.log(`  ${table.padEnd(30)} ${display} rows  [not in TABLE_MAP — DB-only]`);
  }

  console.log("");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("SUMMARY:");
  console.log("=".repeat(60));

  const checked = results.length;
  const fullMatches = results.filter((r) => !r.sheetsError && !r.dbError && r.countMatch && !r.keyMismatch).length;
  const countMismatches = results.filter((r) => !r.sheetsError && !r.dbError && !r.countMatch).length;
  const keyMismatches = results.filter((r) => r.keyMismatch).length;
  const sheetsUnreadable = results.filter((r) => r.sheetsError).length;
  const dbErrors = results.filter((r) => r.dbError).length;

  const platformOnlyList = PLATFORM_ONLY_TABLES.concat(logicTables);

  console.log(`  Tables checked:              ${checked}`);
  console.log(`  Full matches (count+keys):   ${fullMatches}`);
  console.log(`  Row count mismatches:        ${countMismatches}`);
  console.log(`  Key-level mismatches:        ${keyMismatches}`);
  console.log(`  Sheets unreadable:           ${sheetsUnreadable}`);
  console.log(`  DB errors:                   ${dbErrors}`);
  console.log(`  Platform-only (no Sheets):   [${platformOnlyList.join(", ")}]`);
  console.log("");

  // Critical gaps
  const critical = results.filter((r) =>
    !r.sheetsError && !r.dbError && (
      (r.missingInDb.length > 0) ||
      (!r.countMatch && Math.abs(r.dbRows - r.sheetRows) > 5)
    )
  );

  if (critical.length > 0) {
    console.log("  Critical gaps:");
    for (const r of critical) {
      const diff = r.sheetRows - r.dbRows;
      if (r.missingInDb.length > 0) {
        console.log(`    - ${r.dbTable}: ${r.missingInDb.length} keys in Sheets but missing in DB`);
      }
      if (Math.abs(diff) > 5) {
        console.log(`    - ${r.dbTable}: row count delta = ${diff} (Sheets ${r.sheetRows} vs DB ${r.dbRows})`);
      }
    }
  } else {
    console.log("  Critical gaps: none detected");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
