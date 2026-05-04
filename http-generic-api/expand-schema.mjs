/**
 * expand-schema.mjs
 *
 * Reads the current MySQL schema from information_schema and adds any columns
 * present in SHEET_COLUMNS that are missing from the live table.
 * All new columns are added as TEXT NULL.  Existing columns are never modified.
 *
 * Usage:
 *   node expand-schema.mjs                          # dry-run (report only)
 *   node expand-schema.mjs --apply                  # write ALTER TABLE statements
 *   node expand-schema.mjs --table=brands --apply   # single table
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { SHEET_COLUMNS, TABLE_MAP } from "./sqlAdapter.js";
import { getPool } from "./db.js";

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

const args = process.argv.slice(2);
const APPLY    = args.includes("--apply");
const tableArg = (args.find((a) => a.startsWith("--table=")) || "").replace("--table=", "").trim();

// Build reverse map: table → sheet name (for logging)
const SHEET_NAME = Object.fromEntries(
  Object.entries(TABLE_MAP).map(([sheet, table]) => [table, sheet])
);

function toSqlCol(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function getExistingColumns(pool, dbName, table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, table]
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function main() {
  const pool = getPool();

  const [[{ db }]] = await pool.query("SELECT DATABASE() AS db");
  if (!db) { console.error("No database selected"); process.exit(1); }

  console.log(`━━━ Schema Expansion ━━━`);
  console.log(`Mode      : ${APPLY ? "APPLY" : "DRY-RUN (no writes)"}`);
  console.log(`Database  : ${db}`);
  console.log("");

  const tables = tableArg
    ? [Object.entries(TABLE_MAP).find(([, t]) => t === tableArg || tableArg === t)?.[1] ?? tableArg]
    : Object.values(TABLE_MAP);

  let totalNew = 0;
  let totalAdded = 0;

  for (const table of tables) {
    const sheetCols = SHEET_COLUMNS[table];
    if (!sheetCols) { console.log(`  SKIP ${table} — no SHEET_COLUMNS entry`); continue; }

    const existing = await getExistingColumns(pool, db, table);
    const wantCols = sheetCols.map(toSqlCol);
    const newCols  = wantCols.filter((c) => !existing.has(c));

    if (newCols.length === 0) {
      console.log(`  ✓  ${table.padEnd(35)}  (no new columns)`);
      continue;
    }

    console.log(`  ${table.padEnd(35)}  +${newCols.length} new columns:`);
    newCols.forEach((c) => console.log(`       + ${c}`));
    totalNew += newCols.length;

    if (APPLY) {
      let added = 0;
      for (const col of newCols) {
        try {
          await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` TEXT NULL`);
          added++;
        } catch (err) {
          console.log(`       ✗ ${col}: ${err.message}`);
        }
      }
      console.log(`       → added ${added}/${newCols.length}`);
      totalAdded += added;
    }
    console.log("");
  }

  console.log(`━━━ Summary ━━━`);
  console.log(`  New columns detected : ${totalNew}`);
  if (APPLY) console.log(`  Columns added       : ${totalAdded}`);
  else console.log(`  Run with --apply to write ALTER TABLE statements.`);

  await pool.end();
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
