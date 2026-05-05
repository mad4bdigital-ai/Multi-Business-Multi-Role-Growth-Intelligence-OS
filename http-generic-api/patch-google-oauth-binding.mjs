/**
 * patch-google-oauth-binding.mjs
 *
 * Applies Google OAuth2 GPT Actions binding configuration:
 *   1. Adds 5 OAuth registry columns to the `actions` table (if missing)
 *   2. Updates all Google action rows with oauth_client_id_ref, oauth_client_secret_ref,
 *      oauth_secret_storage_type=env_var, and oauth_binding_status=bound
 *
 * Run: node http-generic-api/patch-google-oauth-binding.mjs          (dry-run)
 * Run: node http-generic-api/patch-google-oauth-binding.mjs --apply  (execute)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq < 1) continue;
    const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* ignore */ }

const APPLY = process.argv.includes("--apply");
const pool = getPool();
let ops = 0; let applied = 0;

function log(tag, msg) { console.log(`  [${tag}] ${msg}`); }
function plan(msg) { ops++; log(APPLY ? "APPLY" : "DRY  ", msg); }

async function run(sql, params = []) {
  if (!APPLY) return;
  await pool.query(sql, params);
  applied++;
}

console.log(`\n=== Google OAuth Binding Patcher — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);

// ── 1. Check existing columns ─────────────────────────────────────────────────
console.log("── 1. Checking actions table for OAuth columns");
const [cols] = await pool.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'actions'`
);
const existing = new Set(cols.map(c => c.COLUMN_NAME));

const NEW_COLS = [
  { name: "oauth_client_id_ref",     ddl: "VARCHAR(255) NULL AFTER oauth_config_ref" },
  { name: "oauth_client_secret_ref", ddl: "VARCHAR(255) NULL AFTER oauth_client_id_ref" },
  { name: "oauth_secret_storage_type", ddl: "VARCHAR(100) NULL AFTER oauth_client_secret_ref" },
  { name: "oauth_binding_status",    ddl: "VARCHAR(50) NULL AFTER oauth_secret_storage_type" },
  { name: "oauth_last_validated_at", ddl: "DATETIME NULL AFTER oauth_binding_status" },
];

for (const col of NEW_COLS) {
  if (existing.has(col.name)) {
    log("SKIP", `Column ${col.name} already exists.`);
  } else {
    plan(`ALTER TABLE actions ADD COLUMN ${col.name} ${col.ddl}`);
    await run(`ALTER TABLE \`actions\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
  }
}

// ── 2. Update Google action rows ──────────────────────────────────────────────
const GOOGLE_ACTION_KEYS = [
  "google_sheets_api",
  "google_docs_api",
  "google_drive_api",
  "analytics_admin_api",
  "analytics_data_api",
  "searchads360_api",
  "searchconsole_api",
  "tagmanager_api",
  "googleads_api",
];

console.log("\n── 2. Updating Google action rows with OAuth binding refs");

// Re-check columns after potential ALTER TABLE (in --apply mode they now exist)
const [cols2] = await pool.query(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'actions'`
);
const existing2 = new Set(cols2.map(c => c.COLUMN_NAME));

const oauthCols = ["oauth_client_id_ref", "oauth_client_secret_ref", "oauth_secret_storage_type", "oauth_binding_status"];
const selectCols = ["id", "action_key", ...oauthCols.filter(c => existing2.has(c))].join(", ");

const placeholders = GOOGLE_ACTION_KEYS.map(() => "?").join(",");
const [rows] = await pool.query(
  `SELECT ${selectCols} FROM \`actions\` WHERE action_key IN (${placeholders})`,
  GOOGLE_ACTION_KEYS
);

const WANT = {
  oauth_client_id_ref: "ref:secret:GOOGLE_CLIENT_ID",
  oauth_client_secret_ref: "ref:secret:GOOGLE_CLIENT_SECRET",
  oauth_secret_storage_type: "env_var",
  oauth_binding_status: "bound",
};

for (const row of rows) {
  const changes = [];
  for (const [field, val] of Object.entries(WANT)) {
    if (String(row[field] || "") !== val) changes.push(`${field}: ${row[field] || "NULL"} → ${val}`);
  }
  if (!changes.length) {
    log("SKIP", `${row.action_key} already up-to-date.`);
    continue;
  }
  plan(`id=${row.id} ${row.action_key}: ${changes.join(", ")}`);
  await run(
    `UPDATE \`actions\`
     SET oauth_client_id_ref = ?,
         oauth_client_secret_ref = ?,
         oauth_secret_storage_type = ?,
         oauth_binding_status = ?
     WHERE id = ?`,
    [WANT.oauth_client_id_ref, WANT.oauth_client_secret_ref, WANT.oauth_secret_storage_type, WANT.oauth_binding_status, row.id]
  );
}

const foundKeys = new Set(rows.map(r => r.action_key));
for (const key of GOOGLE_ACTION_KEYS) {
  if (!foundKeys.has(key)) log("MISS", `${key} not found in actions table.`);
}

// ── 3. Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
if (APPLY) {
  console.log(`Done. ${applied}/${ops} operations applied.`);
} else {
  console.log(`Dry-run complete. ${ops} operations planned.`);
  console.log("Re-run with --apply to execute.");
}

await pool.end();
