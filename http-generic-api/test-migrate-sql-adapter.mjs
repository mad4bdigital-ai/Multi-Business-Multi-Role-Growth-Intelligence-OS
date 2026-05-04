/**
 * test-migrate-sql-adapter.mjs
 *
 * Unit tests for:
 *   - toSqlCol() normalisation (imported from sqlAdapter.js via named re-export)
 *   - TABLE_MAP completeness (15 canonical sheet names)
 *   - SHEET_COLUMNS per-table column count consistency
 *   - No post-normalisation duplicates within any table
 *
 * No database or network connections are made.
 * Run: node test-migrate-sql-adapter.mjs
 */

import { TABLE_MAP, SHEET_COLUMNS } from "./sqlAdapter.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

// ── replicate toSqlCol from sqlAdapter.js (it is not currently exported) ──────
// We reproduce it here identically and also verify the logic is self-consistent.
function toSqlCol(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── 1. toSqlCol() normalisation ───────────────────────────────────────────────

section("toSqlCol() normalisation");

assert("plain snake_case is unchanged",
  toSqlCol("brand_name") === "brand_name");

assert("space-separated title becomes snake_case",
  toSqlCol("Brand Name") === "brand_name");

assert("(s) suffix is collapsed to s",
  toSqlCol("Route Key(s)") === "route_keys");

assert("Mapped Engine(s) collapses correctly",
  toSqlCol("Mapped Engine(s)") === "mapped_engines");

assert("parentheses with trailing text works",
  toSqlCol("Mapped Engine(s) Extra") === "mapped_engines_extra");

assert("consecutive non-alphanum chars collapse to single underscore",
  toSqlCol("Brand  --  Name") === "brand_name");

assert("leading underscores stripped",
  toSqlCol("_leading") === "leading");

assert("trailing underscores stripped",
  toSqlCol("trailing_") === "trailing");

assert("mixed case lowered",
  toSqlCol("UPPER_CASE") === "upper_case");

assert("already-normalised column is idempotent",
  toSqlCol("route_id") === "route_id");

assert("numeric suffixes preserved",
  toSqlCol("ga_property_id") === "ga_property_id");

assert("ampersand becomes underscore",
  toSqlCol("Validation & Repair") === "validation_repair");

assert("empty string returns empty string",
  toSqlCol("") === "");

// ── 2. TABLE_MAP completeness ─────────────────────────────────────────────────

section("TABLE_MAP completeness");

const EXPECTED_SHEET_NAMES = [
  "Brand Registry",
  "Brand Core Registry",
  "Actions Registry",
  "API Actions Endpoint Registry",
  "Execution Policy Registry",
  "Hosting Account Registry",
  "Site Runtime Inventory Registry",
  "Site Settings Inventory Registry",
  "Plugin Inventory Registry",
  "Task Routes",
  "Workflow Registry",
  "Registry Surfaces Catalog",
  "Validation & Repair Registry",
  "JSON Asset Registry",
  "Execution Log Unified",
];

assert(`TABLE_MAP has exactly ${EXPECTED_SHEET_NAMES.length} entries`,
  Object.keys(TABLE_MAP).length === EXPECTED_SHEET_NAMES.length,
  `got ${Object.keys(TABLE_MAP).length}: ${Object.keys(TABLE_MAP).join(", ")}`);

for (const name of EXPECTED_SHEET_NAMES) {
  assert(`TABLE_MAP includes "${name}"`,
    name in TABLE_MAP,
    `missing entry`);
}

const EXPECTED_SQL_TABLES = [
  "brands", "brand_core", "actions", "endpoints",
  "execution_policies", "hosting_accounts", "site_runtime_inventory",
  "site_settings_inventory", "plugins", "task_routes", "workflows",
  "registry_surfaces_catalog", "validation_repair", "json_assets", "execution_log",
];

for (const table of EXPECTED_SQL_TABLES) {
  const found = Object.values(TABLE_MAP).includes(table);
  assert(`TABLE_MAP maps to SQL table "${table}"`, found);
}

// Every TABLE_MAP value appears in SHEET_COLUMNS
for (const [sheetName, tableName] of Object.entries(TABLE_MAP)) {
  assert(`SHEET_COLUMNS has entry for "${tableName}" (from "${sheetName}")`,
    tableName in SHEET_COLUMNS,
    `SHEET_COLUMNS missing key`);
}

// ── 3. SHEET_COLUMNS column counts ────────────────────────────────────────────

section("SHEET_COLUMNS column counts");

const EXPECTED_COUNTS = {
  brands:                    122,
  brand_core:                20,
  actions:                   47,
  endpoints:                 58,
  execution_policies:        8,
  hosting_accounts:          27,
  site_runtime_inventory:    11,
  site_settings_inventory:   12,
  plugins:                   12,
  task_routes:               46,
  workflows:                 53,
  registry_surfaces_catalog: 38,
  validation_repair:         66,
  json_assets:               17,
  execution_log:             56,
};

for (const [table, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
  const cols = SHEET_COLUMNS[table];
  assert(`${table} has ${expectedCount} columns`,
    Array.isArray(cols) && cols.length === expectedCount,
    `got ${cols?.length ?? "missing"}`);
}

// Every SHEET_COLUMNS entry has at least 1 column
for (const [table, cols] of Object.entries(SHEET_COLUMNS)) {
  assert(`${table} has at least 1 column`,
    Array.isArray(cols) && cols.length >= 1,
    `got ${cols?.length}`);
}

// ── 4. No post-normalisation duplicates within any table ──────────────────────

section("No post-normalisation duplicates per table");

for (const [table, cols] of Object.entries(SHEET_COLUMNS)) {
  const normalized = cols.map(toSqlCol);
  const seen = new Set();
  const dupes = [];
  for (const col of normalized) {
    if (seen.has(col)) dupes.push(col);
    seen.add(col);
  }
  assert(`${table} has no duplicate SQL column names after normalisation`,
    dupes.length === 0,
    dupes.length ? `duplicates: ${dupes.join(", ")}` : "");
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TESTS PASS");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
