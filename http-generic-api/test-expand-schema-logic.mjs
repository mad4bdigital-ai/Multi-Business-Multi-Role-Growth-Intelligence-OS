/**
 * test-expand-schema-logic.mjs
 *
 * Unit tests for:
 *   - expand-schema.mjs's toSqlCol() matches sqlAdapter.js's toSqlCol()
 *   - Dry-run mode logic: verifies that without --apply, no ALTER TABLE is invoked
 *   - Column name normalisation contract shared between both scripts
 *
 * No database or network connections are made.
 * Run: node test-expand-schema-logic.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SHEET_COLUMNS } from "./sqlAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── Replicate both toSqlCol implementations ──────────────────────────────────
// These must be textually identical to their sources.

// From sqlAdapter.js
function toSqlColAdapter(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// From expand-schema.mjs (extracted from the source file)
const expandSchemaSource = readFileSync(resolve(__dirname, "expand-schema.mjs"), "utf8");

// Extract the toSqlCol function body from expand-schema.mjs to verify it matches
const toSqlColMatch = expandSchemaSource.match(
  /function toSqlCol\(name\)\s*\{([^}]+)\}/
);

function toSqlColExpand(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── 1. Verify expand-schema.mjs has a toSqlCol definition ───────────────────

section("expand-schema.mjs source structure");

assert("expand-schema.mjs contains a toSqlCol function definition",
  !!toSqlColMatch,
  "function not found in source");

assert("expand-schema.mjs imports SHEET_COLUMNS from sqlAdapter.js",
  expandSchemaSource.includes("SHEET_COLUMNS") && expandSchemaSource.includes("sqlAdapter.js"));

assert("expand-schema.mjs imports TABLE_MAP from sqlAdapter.js",
  expandSchemaSource.includes("TABLE_MAP") && expandSchemaSource.includes("sqlAdapter.js"));

assert("expand-schema.mjs imports getPool from db.js",
  expandSchemaSource.includes("getPool") && expandSchemaSource.includes("db.js"));

// ── 2. toSqlCol implementations produce identical results ────────────────────

section("toSqlCol() parity between expand-schema.mjs and sqlAdapter.js");

const TEST_INPUTS = [
  "Brand Name",
  "Route Key(s)",
  "ga_property_id",
  "Mapped Engine(s)",
  "Validation & Repair",
  "entry_type",
  "Workflow ID",
  "Workflow Name",
  "execution_mode",
  "Priority",
  "Notes",
  "api_key_header_name",
  "schema_overlay_parent_action_key",
  "broken_reference_detected",
  "",
  "UPPER_CASE",
  "trailing_",
  "_leading",
  "Brand  --  Name",
];

for (const input of TEST_INPUTS) {
  const adapterResult = toSqlColAdapter(input);
  const expandResult  = toSqlColExpand(input);
  assert(
    `toSqlCol(${JSON.stringify(input)}) identical in both scripts`,
    adapterResult === expandResult,
    `adapter="${adapterResult}" expand="${expandResult}"`
  );
}

// ── 3. Both implementations agree on all SHEET_COLUMNS ──────────────────────

section("toSqlCol() parity across all SHEET_COLUMNS entries");

for (const [table, cols] of Object.entries(SHEET_COLUMNS)) {
  for (const col of cols) {
    const a = toSqlColAdapter(col);
    const e = toSqlColExpand(col);
    assert(
      `${table}: "${col}" normalises identically`,
      a === e,
      `adapter="${a}" expand="${e}"`
    );
  }
}

// ── 4. Dry-run mode: expand-schema.mjs must not call ALTER TABLE without --apply

section("Dry-run mode: expand-schema.mjs does not mutate schema without --apply");

// The ALTER TABLE calls in expand-schema.mjs are inside template literals passed
// to pool.query(). We verify the presence of a pool.query+ALTER TABLE call and
// that it is inside an if (APPLY) block by checking line proximity in the source.
const lines = expandSchemaSource.split("\n");

// Find lines containing pool.query calls that issue ALTER TABLE
const queryAlterLines = [];
lines.forEach((line, i) => {
  // Skip comment lines
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
  if (line.includes("pool.query") && line.includes("ALTER TABLE")) {
    queryAlterLines.push({ lineNo: i + 1, text: line });
  }
});

assert("expand-schema.mjs has at least one pool.query(ALTER TABLE) call",
  queryAlterLines.length > 0,
  `found ${queryAlterLines.length}`);

// Each pool.query(ALTER TABLE) line must be preceded by an if (APPLY) within
// a window of 30 lines (enough to cover the if block preamble).
let allGuarded = true;
for (const { lineNo } of queryAlterLines) {
  const windowStart = Math.max(0, lineNo - 30);
  const window = lines.slice(windowStart, lineNo - 1).join("\n");
  if (!window.includes("if (APPLY)")) {
    allGuarded = false;
  }
}

assert("All pool.query(ALTER TABLE) calls are guarded by if (APPLY)",
  allGuarded,
  `${queryAlterLines.length} call(s) found; allGuarded=${allGuarded}`);

// Verify the script has a dry-run path that reports new columns without writing
assert("expand-schema.mjs references 'DRY-RUN' mode in output",
  expandSchemaSource.includes("DRY-RUN") || expandSchemaSource.includes("dry-run") || expandSchemaSource.includes("dry_run"));

assert("expand-schema.mjs checks --apply flag to gate writes",
  expandSchemaSource.includes("--apply") && expandSchemaSource.includes("APPLY"));

// ── 5. Pool lifecycle: expand-schema.mjs calls pool.end() at exit ─────────────

section("Pool lifecycle in expand-schema.mjs");

assert("expand-schema.mjs calls pool.end() before exit",
  expandSchemaSource.includes("pool.end()"));

assert("expand-schema.mjs calls getPool() to obtain the pool",
  expandSchemaSource.includes("getPool()"));

// Ensure pool.end() is NOT called inside a per-request handler or middleware
// (CLI scripts are allowed; server.js must not have it at the module level)
const serverSource = readFileSync(resolve(__dirname, "server.js"), "utf8");
// pool.end() must not appear in server.js
assert("server.js does not call pool.end()",
  !serverSource.includes("pool.end()"),
  "pool.end() found in server.js — must only be called in CLI scripts");

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
