/**
 * patch-google-github-auth.mjs
 *
 * Fixes two auth-mode gaps identified by the schema coverage audit:
 *
 * 1. github_api_mcp — api_key_mode was 'api_key_header' which injected
 *    Authorization: <raw_token>. GitHub needs Authorization: Bearer <token>.
 *    Fix: set api_key_mode = 'bearer_token'.
 *
 * 2. Google API actions (Sheets, Docs, Drive, Analytics Admin/Data,
 *    Search Ads 360, Search Console, Tag Manager) — api_key_mode was NULL,
 *    no auth was injected. Fix: set api_key_mode = 'google_oauth2',
 *    api_key_storage_mode = 'google_service_account', and mark runtime_callable = 1.
 *    The googleAuthTokenResolver.js module resolves the token at runtime from
 *    GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_SA_JSON / GOOGLE_REFRESH_TOKEN.
 *
 * googleads_api is intentionally left at runtime_callable=FALSE — it requires
 * OAuth2 + a developer-token header + login-customer-id, which needs dedicated handling.
 *
 * Run: node http-generic-api/patch-google-github-auth.mjs          (dry-run)
 * Run: node http-generic-api/patch-google-github-auth.mjs --apply  (execute)
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

async function run(sql, params) {
  if (!APPLY) return;
  await pool.query(sql, params);
  applied++;
}

console.log(`\n=== GitHub + Google Auth Patcher — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);

// ── 1. GitHub: api_key_mode fix ───────────────────────────────────────────────
console.log("── 1. github_api_mcp: fix api_key_mode → bearer_token");
const [ghRows] = await pool.query(
  "SELECT id, action_key, api_key_mode FROM `actions` WHERE action_key = 'github_api_mcp' LIMIT 1"
);
if (!ghRows.length) {
  log("SKIP", "github_api_mcp not found.");
} else {
  const gh = ghRows[0];
  if (gh.api_key_mode === "bearer_token") {
    log("SKIP", `github_api_mcp already has api_key_mode=bearer_token.`);
  } else {
    plan(`id=${gh.id}: api_key_mode ${gh.api_key_mode} → bearer_token`);
    await run("UPDATE `actions` SET api_key_mode = 'bearer_token' WHERE id = ?", [gh.id]);
  }
}

// ── 2. Google API actions: add google_oauth2 mode + enable callable ───────────
const GOOGLE_ACTION_KEYS = [
  "google_sheets_api",
  "google_docs_api",
  "google_drive_api",
  "analytics_admin_api",
  "analytics_data_api",
  "searchads360_api",
  "searchconsole_api",
  "tagmanager_api",
];

console.log("\n── 2. Google API actions: set api_key_mode=google_oauth2 + runtime_callable=1");
const placeholders = GOOGLE_ACTION_KEYS.map(() => "?").join(",");
const [gRows] = await pool.query(
  `SELECT id, action_key, api_key_mode, api_key_storage_mode, secret_store_ref, runtime_callable
   FROM \`actions\` WHERE action_key IN (${placeholders})`,
  GOOGLE_ACTION_KEYS
);

for (const row of gRows) {
  const changes = [];
  if (row.api_key_mode !== "google_oauth2") changes.push(`api_key_mode: ${row.api_key_mode} → google_oauth2`);
  if (row.api_key_storage_mode !== "google_service_account") changes.push(`api_key_storage_mode: ${row.api_key_storage_mode} → google_service_account`);
  if (String(row.secret_store_ref || "") !== "ref:google:service_account") changes.push(`secret_store_ref: ${row.secret_store_ref} → ref:google:service_account`);
  if (String(row.runtime_callable) !== "1" && row.runtime_callable !== 1 && row.runtime_callable !== "TRUE") changes.push(`runtime_callable: ${row.runtime_callable} → 1`);

  if (!changes.length) {
    log("SKIP", `${row.action_key} already up-to-date.`);
    continue;
  }
  plan(`id=${row.id} ${row.action_key}: ${changes.join(", ")}`);
  await run(
    `UPDATE \`actions\`
     SET api_key_mode = 'google_oauth2',
         api_key_storage_mode = 'google_service_account',
         secret_store_ref = 'ref:google:service_account',
         runtime_callable = 1
     WHERE id = ?`,
    [row.id]
  );
}

// Report any expected action keys that weren't found
const foundKeys = new Set(gRows.map(r => r.action_key));
for (const key of GOOGLE_ACTION_KEYS) {
  if (!foundKeys.has(key)) log("MISS", `${key} not found in actions table.`);
}

// ── 3. Env var check ──────────────────────────────────────────────────────────
console.log("\n── 3. Google credential env vars");
const credChecks = [
  ["GOOGLE_APPLICATION_CREDENTIALS", "path to service account JSON file"],
  ["GOOGLE_SA_JSON",                  "inline service account JSON (or base64)"],
  ["GOOGLE_REFRESH_TOKEN",            "OAuth2 refresh token (user-based flow)"],
];
for (const [key, desc] of credChecks) {
  const val = process.env[key];
  console.log(`  ${val ? "[OK]  " : "[MISS]"} ${key}${val ? "" : " — " + desc}`);
}
const hasAny = credChecks.some(([k]) => !!process.env[k]);
if (!hasAny) {
  console.log("\n  ⚠️  No Google credentials are set. Google API actions will return 401.");
  console.log("  Recommended: add GOOGLE_APPLICATION_CREDENTIALS=<path-to-sa.json> to .env");
}

// ── 4. Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
if (APPLY) {
  console.log(`Done. ${applied}/${ops} operations applied.`);
  console.log("Restart the server so googleAuthTokenResolver.js pre-warms the token cache.");
} else {
  console.log(`Dry-run complete. ${ops} operations planned.`);
  console.log("Re-run with --apply to execute.");
}

await pool.end();
