/**
 * sanitize-credentials.mjs
 *
 * One-time cleanup script:
 *  1. NULLs out embedded credential values from SQL tables
 *  2. Updates api_key_storage_mode to 'secret_reference' so the runtime
 *     knows to resolve from env vars via resolveSecretFromReference()
 *  3. Writes canonical secret_store_ref values in ref:secret:<ENV_VAR> format
 *
 * Prerequisites:
 *  - Rotate all exposed credentials BEFORE running this script.
 *  - Add the new values as env vars in .env (see "Required env vars" output).
 *  - Run: node http-generic-api/sanitize-credentials.mjs          (dry-run)
 *  - Run: node http-generic-api/sanitize-credentials.mjs --apply  (execute)
 *
 * After running, also clear the same cells in the source Google Sheets
 * (the SQL cleanup does not write back to Sheets).
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
    const k = t.slice(0, eq).trim(); const v = t.slice(eq+1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* ignore */ }

const APPLY = process.argv.includes("--apply");
const pool = getPool();

let ops = 0;
let applied = 0;

function plan(label) {
  ops++;
  if (APPLY) {
    console.log(`  [APPLY] ${label}`);
  } else {
    console.log(`  [DRY]   ${label}`);
  }
}

async function run(sql, params = []) {
  if (!APPLY) return;
  await pool.query(sql, params);
  applied++;
}

console.log(`\n=== Credential Sanitizer — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);

// ── 1. Actions — embedded API key values ──────────────────────────────────────
// Map: action_key → { envVar, newStorageMode, newSecretRef }
const ACTION_CREDENTIAL_MAP = {
  serpapi_search:    { envVar: "SERPAPI_API_KEY",              newRef: "ref:secret:SERPAPI_API_KEY" },
  scraperapi_scrape: { envVar: "SCRAPERAPI_API_KEY",           newRef: "ref:secret:SCRAPERAPI_API_KEY" },
  abstractapi_scrape:{ envVar: "ABSTRACTAPI_API_KEY",          newRef: "ref:secret:ABSTRACTAPI_API_KEY" },
  googleads_api:     { envVar: "GOOGLEADS_DEVELOPER_TOKEN",    newRef: "ref:secret:GOOGLEADS_DEVELOPER_TOKEN" },
  github_api_mcp:    { envVar: "GITHUB_TOKEN",                 newRef: "ref:secret:GITHUB_TOKEN" },
  make_mcp_server:   { envVar: "MAKE_MCP_TOKEN",               newRef: "ref:secret:MAKE_MCP_TOKEN" },
};

console.log("── 1. Actions with embedded api_key_value");
const [actionRows] = await pool.query(
  "SELECT id, action_key, api_key_storage_mode, secret_store_ref FROM actions WHERE api_key_value IS NOT NULL AND api_key_value != '' LIMIT 30"
);

for (const row of actionRows) {
  const mapping = ACTION_CREDENTIAL_MAP[row.action_key];
  if (!mapping) {
    console.log(`  [SKIP]  id=${row.id} action_key=${row.action_key} — no mapping defined, review manually`);
    continue;
  }
  plan(`id=${row.id} ${row.action_key}: NULL api_key_value, set storage_mode=secret_reference, ref=${mapping.newRef}`);
  await run(
    "UPDATE actions SET api_key_value = NULL, api_key_storage_mode = 'secret_reference', secret_store_ref = ? WHERE id = ?",
    [mapping.newRef, row.id]
  );
}

// ── 2. Brands — embedded application_password ──────────────────────────────────
// Env var convention: TARGET_KEY uppercased, dots+hyphens → underscore, suffix _WP_APP_PASSWORD
function wpEnvVar(brand) {
  return String(brand.target_key || brand.brand_name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    + "_APP_PASSWORD";
}

console.log("\n── 2. Brands with embedded application_password");
const [brandRows] = await pool.query(
  "SELECT id, brand_name, target_key FROM brands WHERE application_password IS NOT NULL AND application_password != '' LIMIT 20"
);

for (const row of brandRows) {
  const envVar = wpEnvVar(row);
  plan(`id=${row.id} ${row.brand_name}: NULL application_password  [set env var: ${envVar}=<rotated_value>]`);
  await run("UPDATE brands SET application_password = NULL WHERE id = ?", [row.id]);
}

// ── 3. Hosting accounts — embedded api_key_reference ──────────────────────────
// Map: hosting_account_key → env var name
const HOSTING_CREDENTIAL_MAP = {
  hostinger_cloud_plan_01:       "HOSTINGER_CLOUD_PLAN_01_API_KEY",
  hostinger_shared_manager_01:   "HOSTINGER_SHARED_MANAGER_01_API_KEY",
};

console.log("\n── 3. Hosting accounts with embedded api_key_reference");
const [hostRows] = await pool.query(
  "SELECT id, hosting_account_key, hosting_provider FROM hosting_accounts WHERE api_key_storage_mode = 'embedded_sheet' LIMIT 20"
);

for (const row of hostRows) {
  const envVar = HOSTING_CREDENTIAL_MAP[row.hosting_account_key]
    || row.hosting_account_key.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_API_KEY";
  const newRef = "ref:secret:" + envVar;
  plan(`id=${row.id} ${row.hosting_account_key}: set api_key_reference=${newRef}, storage_mode=secret_reference  [set env var: ${envVar}=<rotated_value>]`);
  await run(
    "UPDATE hosting_accounts SET api_key_reference = ?, api_key_storage_mode = 'secret_reference' WHERE id = ?",
    [newRef, row.id]
  );
}

// ── 4. Summary ─────────────────────────────────────────────────────────────────
console.log("\n── 4. Required env vars to add to .env after rotating secrets");
const required = [
  ...Object.values(ACTION_CREDENTIAL_MAP).map((m) => m.envVar),
  ...brandRows.map(wpEnvVar),
  ...Object.values(HOSTING_CREDENTIAL_MAP),
];
const unique = [...new Set(required)];
for (const v of unique) {
  const exists = !!process.env[v];
  console.log(`  ${exists ? "[OK]  " : "[MISS]"} ${v}${exists ? " (already set)" : " = <add after rotating>"}`);
}

console.log(`\n${"-".repeat(55)}`);
if (APPLY) {
  console.log(`Done. ${applied}/${ops} operations applied.`);
  console.log("Next: clear the same cells in the source Google Sheets.");
  console.log("      run node migrate-sheets-to-sql.mjs --merge to re-sync (values will be NULL in SQL).");
} else {
  console.log(`Dry-run complete. ${ops} operations planned.`);
  console.log("Re-run with --apply to execute.");
}

await pool.end();
