/**
 * migrate-sheets-to-sql.mjs
 *
 * Modes:
 *   Seed (default)  — bulk insert, optionally truncating first.
 *   Merge           — row-level diff: insert missing, update changed, skip unchanged.
 *                     Dry-run by default; requires --apply to write.
 *
 * Usage:
 *   node migrate-sheets-to-sql.mjs                              # seed all tables (append)
 *   node migrate-sheets-to-sql.mjs --truncate                   # truncate then insert
 *   node migrate-sheets-to-sql.mjs --ignore                     # INSERT IGNORE (skip dupes)
 *   node migrate-sheets-to-sql.mjs --dry-run                    # read only, no SQL writes
 *   node migrate-sheets-to-sql.mjs --table="Brand Registry"     # single table
 *
 *   node migrate-sheets-to-sql.mjs --merge                      # merge dry-run (all tables)
 *   node migrate-sheets-to-sql.mjs --merge --apply              # merge and write
 *   node migrate-sheets-to-sql.mjs --merge --table="Task Routes" --apply
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import {
  bulkInsertRows,
  clearTable,
  readTableRaw,
  updateRowById,
  appendRow,
  TABLE_MAP,
  SHEET_COLUMNS
} from "./sqlAdapter.js";
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
const MERGE    = args.includes("--merge");
const APPLY    = args.includes("--apply");
const DRY_RUN  = MERGE ? !APPLY : args.includes("--dry-run");
const TRUNCATE = args.includes("--truncate");
const IGNORE   = args.includes("--ignore");
const tableArg = (args.find((a) => a.startsWith("--table=")) || "").replace("--table=", "").trim();
const TARGET_TABLES = tableArg ? [tableArg] : Object.keys(TABLE_MAP);

// ── AppScript-managed sheets ───────────────────────────────────────────────────
// These sheets have Google AppScript writing to them for system enforcement events.
// In merge mode they are treated as append-only from the migrator's perspective:
// the migrator reads new rows from Sheets → SQL (insert only) but does NOT update
// existing SQL rows, because AppScript may have modified them since last sync.
// This prevents the migrator from overwriting AppScript-computed row edits with
// stale SQL snapshots.
const APPSCRIPT_MANAGED_SHEETS = new Set([
  "Execution Log Unified",
]);

// ── Natural keys per sheet (sheet column name format) ─────────────────────────
// Null = append-only (no stable natural key, skip in merge mode).
const NATURAL_KEYS = {
  "Brand Registry":                  ["target_key"],
  "Brand Core Registry":             ["brand_key"],
  "Actions Registry":                ["action_key"],
  "API Actions Endpoint Registry":   ["endpoint_id"],
  "Execution Policy Registry":       ["policy_group", "policy_key"],
  "Hosting Account Registry":        ["hosting_account_key"],
  "Site Runtime Inventory Registry": ["target_key"],
  "Site Settings Inventory Registry":["target_key"],
  "Plugin Inventory Registry":       ["target_key"],
  "Task Routes":                     ["route_id"],
  "Workflow Registry":               ["Workflow ID"],
  "Registry Surfaces Catalog":       ["surface_id"],
  "Validation & Repair Registry":    ["validation_id"],
  "JSON Asset Registry":             ["asset_id"],
  "Execution Log Unified":           null,
};

// ── Spreadsheet ID mapping ─────────────────────────────────────────────────────
const REGISTRY_ID   = process.env.REGISTRY_SPREADSHEET_ID  || "";
const ACTIVITY_ID   = process.env.ACTIVITY_SPREADSHEET_ID  || REGISTRY_ID;
const EXEC_LOG_ID   = process.env.EXECUTION_LOG_UNIFIED_SPREADSHEET_ID || ACTIVITY_ID;
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
// Returns { rows, formulaColumns }.
// formulaColumns: Set of column header names that contain formula cells in ANY
// data row. These columns are excluded from merge-mode UPDATE payloads to avoid
// overwriting live formula-computed values with stale SQL snapshots.
async function readSheetRows(sheets, spreadsheetId, sheetName) {
  const range = `${sheetName}!A:AZ`;

  // Primary fetch — formatted computed values (what users see)
  const valueRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values = valueRes.data.values || [];
  if (!values.length) return { rows: [], formulaColumns: new Set() };

  const header = values[0].map((v) => String(v || "").trim());

  // Secondary fetch — raw formula strings so we can detect formula-driven cells
  let formulaValues = [];
  try {
    const formulaRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "FORMULA",
    });
    formulaValues = formulaRes.data.values || [];
  } catch {
    // Non-fatal: skip formula detection if this workbook doesn't allow it
  }

  // Build set of columns that have at least one formula cell in any data row
  const formulaColumns = new Set();
  if (formulaValues.length > 1) {
    const fHeader = formulaValues[0].map((v) => String(v || "").trim());
    for (const fRow of formulaValues.slice(1)) {
      fRow.forEach((cell, idx) => {
        if (String(cell || "").startsWith("=")) {
          const colName = fHeader[idx];
          if (colName) formulaColumns.add(colName);
        }
      });
    }
  }

  const rows = values.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const record = {};
      header.forEach((key, idx) => {
        if (key) record[key] = String(row[idx] ?? "");
      });
      return record;
    });

  return { rows, formulaColumns };
}

// ── Natural key helpers ────────────────────────────────────────────────────────
function buildNaturalKey(row, keyFields) {
  return keyFields.map((f) => String(row[f] ?? "").trim()).join("||");
}

function rowValuesSignature(row, cols) {
  return cols.map((col) => String(row[col] ?? "")).join("||");
}

// ── Seed mode: one table ───────────────────────────────────────────────────────
async function seedTable(sheets, sheetName) {
  const spreadsheetId = spreadsheetIdFor(sheetName);
  if (!spreadsheetId) {
    return { sheetName, status: "skipped", reason: "no spreadsheet ID" };
  }

  let sheetRows, formulaColumns;
  try {
    ({ rows: sheetRows, formulaColumns } = await readSheetRows(sheets, spreadsheetId, sheetName));
  } catch (err) {
    return { sheetName, status: "error", reason: `Sheets read failed: ${err.message}` };
  }

  if (sheetRows.length === 0) {
    return { sheetName, status: "empty", rows: 0 };
  }

  const formulaInfo = formulaColumns.size ? ` (${formulaColumns.size} formula columns detected)` : "";
  if (DRY_RUN) {
    return { sheetName, status: "dry-run", rows: sheetRows.length, note: formulaInfo || undefined };
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
    return { sheetName, status: "ok", rows: inserted, note: formulaInfo || undefined };
  } catch (err) {
    return { sheetName, status: "error", reason: `SQL insert failed: ${err.message}` };
  }
}

// ── Merge mode: one table ──────────────────────────────────────────────────────
async function mergeTable(sheets, sheetName) {
  const keyFields = NATURAL_KEYS[sheetName];

  if (keyFields === null) {
    return { sheetName, status: "skipped", reason: "append-only table (no natural key)" };
  }
  if (!keyFields) {
    return { sheetName, status: "skipped", reason: "no natural key defined" };
  }

  // AppScript-managed sheets: insert new rows only, never update existing SQL rows.
  // AppScript may have modified them since last sync and those edits must not be overwritten.
  const appScriptManaged = APPSCRIPT_MANAGED_SHEETS.has(sheetName);

  const spreadsheetId = spreadsheetIdFor(sheetName);
  if (!spreadsheetId) {
    return { sheetName, status: "skipped", reason: "no spreadsheet ID" };
  }

  // Load Sheets rows
  let sheetRows, formulaColumns;
  try {
    ({ rows: sheetRows, formulaColumns } = await readSheetRows(sheets, spreadsheetId, sheetName));
  } catch (err) {
    return { sheetName, status: "error", reason: `Sheets read failed: ${err.message}` };
  }

  if (sheetRows.length === 0) {
    return { sheetName, status: "empty", inserted: 0, updated: 0, unchanged: 0, conflicted: 0 };
  }

  // Detect duplicate natural keys in Sheets
  const sheetKeySeen = new Map();
  const conflicts = [];
  const dedupedSheetRows = [];

  for (const row of sheetRows) {
    const key = buildNaturalKey(row, keyFields);
    if (!key.replace(/\|/g, "").trim()) continue; // skip rows with empty key
    if (sheetKeySeen.has(key)) {
      conflicts.push(key);
    } else {
      sheetKeySeen.set(key, row);
      dedupedSheetRows.push(row);
    }
  }

  // Load SQL rows (keyed by natural key, keeping id for UPDATE)
  let sqlRows;
  try {
    sqlRows = await readTableRaw(sheetName);
  } catch (err) {
    return { sheetName, status: "error", reason: `SQL read failed: ${err.message}` };
  }

  const sqlByKey = new Map();
  for (const row of sqlRows) {
    const key = buildNaturalKey(row, keyFields);
    if (key.replace(/\|/g, "").trim()) {
      sqlByKey.set(key, row);
    }
  }

  // Diff — exclude formula-driven columns from signature and update payload.
  // Formula cells are computed live in Sheets; writing stale SQL snapshots back
  // would destroy the formula. AppScript-managed sheets skip all updates entirely.
  const allCols = SHEET_COLUMNS[TABLE_MAP[sheetName]] || [];
  const diffCols = allCols.filter((c) => !formulaColumns.has(c));
  const toInsert = [];
  const toUpdate = [];
  let unchanged = 0;

  for (const sheetRow of dedupedSheetRows) {
    const key = buildNaturalKey(sheetRow, keyFields);
    const sqlRow = sqlByKey.get(key);

    if (!sqlRow) {
      toInsert.push(sheetRow);
    } else if (!appScriptManaged) {
      // Only diff/update non-AppScript-managed sheets
      const sheetSig = rowValuesSignature(sheetRow, diffCols);
      const sqlSig   = rowValuesSignature(sqlRow, diffCols);
      if (sheetSig !== sqlSig) {
        toUpdate.push({ sheetRow, sqlId: sqlRow.id });
      } else {
        unchanged++;
      }
    } else {
      unchanged++;
    }
  }

  const formulaNote = formulaColumns.size
    ? ` | ${formulaColumns.size} formula cols excluded from diff`
    : "";
  const appScriptNote = appScriptManaged ? " | AppScript-managed: updates skipped" : "";

  const summary = {
    sheetName,
    status: "ok",
    inserted: toInsert.length,
    updated: toUpdate.length,
    unchanged,
    conflicted: conflicts.length,
    conflicts: conflicts.length ? conflicts.slice(0, 5) : undefined,
    dry_run: DRY_RUN,
    note: (formulaNote + appScriptNote) || undefined,
  };

  if (DRY_RUN) return summary;

  // Apply inserts
  for (const row of toInsert) {
    try {
      await appendRow(sheetName, row);
    } catch (err) {
      return { ...summary, status: "error", reason: `INSERT failed: ${err.message}` };
    }
  }

  // Apply updates (skipped for AppScript-managed sheets)
  for (const { sheetRow, sqlId } of toUpdate) {
    try {
      await updateRowById(sheetName, sheetRow, sqlId);
    } catch (err) {
      return { ...summary, status: "error", reason: `UPDATE id=${sqlId} failed: ${err.message}` };
    }
  }

  return summary;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const modeLabel = MERGE
    ? (DRY_RUN ? "MERGE (dry-run — no writes)" : "MERGE + APPLY")
    : DRY_RUN ? "DRY RUN (no writes)"
    : TRUNCATE ? "TRUNCATE + INSERT"
    : "INSERT (append)";

  console.log("━━━ Growth OS — Sheets → MySQL Migrator ━━━");
  console.log(`Mode   : ${modeLabel}`);
  console.log(`Tables : ${TARGET_TABLES.length === Object.keys(TABLE_MAP).length ? `all ${Object.keys(TABLE_MAP).length}` : TARGET_TABLES.join(", ")}`);
  console.log(`DB     : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  if (MERGE && DRY_RUN) {
    console.log(`\nℹ  Pass --apply to write changes.`);
  }
  console.log("");

  if (!REGISTRY_ID) {
    console.error("ERROR: REGISTRY_SPREADSHEET_ID not set in .env — cannot read from Sheets.");
    process.exit(1);
  }

  // Verify DB connection
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

  const results = [];

  for (const sheetName of TARGET_TABLES) {
    process.stdout.write(`  ${sheetName.padEnd(40)} ...`);

    const result = MERGE
      ? await mergeTable(sheets, sheetName)
      : await seedTable(sheets, sheetName);

    results.push(result);

    if (MERGE) {
      const icon = result.status === "error"   ? "✗"
                 : result.status === "skipped"  ? "–"
                 : result.status === "empty"    ? "○"
                 : "~";

      const parts = result.status === "error"   ? [result.reason]
                  : result.status === "skipped"  ? [result.reason]
                  : result.status === "empty"    ? ["empty"]
                  : [
                      `+${result.inserted} insert`,
                      `~${result.updated} update`,
                      `=${result.unchanged} unchanged`,
                      result.conflicted ? `!${result.conflicted} conflict` : null
                    ].filter(Boolean);

      console.log(` ${icon}  ${parts.join("  ")}`);

      if (result.conflicts?.length) {
        result.conflicts.forEach((k) => console.log(`       conflict key: ${k}`));
      }
    } else {
      const icon = result.status === "ok"       ? "✓"
                 : result.status === "dry-run"   ? "~"
                 : result.status === "empty"     ? "○"
                 : result.status === "skipped"   ? "–" : "✗";

      const detail = result.status === "error" ? result.reason
                   : result.rows != null ? `${result.rows} rows`
                   : result.reason || "";

      console.log(` ${icon}  ${detail}`);
    }
  }

  // Summary
  console.log("");
  console.log("━━━ Summary ━━━");

  if (MERGE) {
    const done    = results.filter((r) => r.status === "ok");
    const errors  = results.filter((r) => r.status === "error");
    const skipped = results.filter((r) => r.status === "skipped");
    const totalI  = done.reduce((s, r) => s + (r.inserted || 0), 0);
    const totalU  = done.reduce((s, r) => s + (r.updated  || 0), 0);
    const totalN  = done.reduce((s, r) => s + (r.unchanged|| 0), 0);
    const totalC  = done.reduce((s, r) => s + (r.conflicted||0), 0);

    if (DRY_RUN) {
      console.log(`  Would insert   : ${totalI} rows`);
      console.log(`  Would update   : ${totalU} rows`);
      console.log(`  Unchanged      : ${totalN} rows`);
      if (totalC) console.log(`  Conflicts      : ${totalC} duplicate keys in Sheets (would skip)`);
    } else {
      console.log(`  Inserted       : ${totalI} rows`);
      console.log(`  Updated        : ${totalU} rows`);
      console.log(`  Unchanged      : ${totalN} rows`);
      if (totalC) console.log(`  Conflicts      : ${totalC} duplicate keys skipped`);
    }
    if (skipped.length) console.log(`  Skipped tables : ${skipped.length}`);
    if (errors.length) {
      console.log(`\n  Errors:`);
      errors.forEach((e) => console.log(`    ✗ ${e.sheetName}: ${e.reason}`));
    }
  } else {
    const ok      = results.filter((r) => r.status === "ok").length;
    const empty   = results.filter((r) => r.status === "empty").length;
    const errors  = results.filter((r) => r.status === "error");
    const dryRuns = results.filter((r) => r.status === "dry-run").length;
    const total   = results.filter((r) => r.rows != null).reduce((s, r) => s + (r.rows || 0), 0);

    if (DRY_RUN) {
      console.log(`  Would migrate  : ${total} rows across ${dryRuns} tables`);
    } else {
      console.log(`  Migrated       : ${total} rows — ${ok} tables OK, ${empty} empty, ${errors.length} errors`);
    }

    if (errors.length) {
      console.log("\n  Errors:");
      errors.forEach((e) => console.log(`    ✗ ${e.sheetName}: ${e.reason}`));
    }
  }

  await getPool().end();
  process.exit(results.some((r) => r.status === "error") ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
