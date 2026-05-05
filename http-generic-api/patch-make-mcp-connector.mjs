/**
 * patch-make-mcp-connector.mjs
 *
 * One-time DB patch: wires the make_mcp_server action row so the runtime
 * can dispatch it as an MCP connector via connectorExecutor.dispatchPlan().
 *
 * Sets on the `actions` row where action_key = 'make_mcp_server':
 *   runtime_callable       = 1
 *   primary_executor       = http_client_backend
 *   runtime_capability_class = mcp_connector
 *   api_key_mode           = bearer_token
 *   api_key_storage_mode   = secret_reference
 *   secret_store_ref       = ref:secret:MAKE_MCP_TOKEN
 *   api_key_value          = NULL  (clear any embedded remnant)
 *
 * Also ensures any connected_systems rows for Make MCP have connector_family = 'make_mcp'
 * so connectorExecutor.dispatchPlan() can detect them.
 *
 * Run: node http-generic-api/patch-make-mcp-connector.mjs          (dry-run)
 * Run: node http-generic-api/patch-make-mcp-connector.mjs --apply  (execute)
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

console.log(`\n=== Make MCP Connector Patcher — ${APPLY ? "APPLY" : "DRY RUN"} ===\n`);

// ── 1. Verify MAKE_MCP_TOKEN is set ──────────────────────────────────────────
const token = process.env.MAKE_MCP_TOKEN || "";
console.log(`MAKE_MCP_TOKEN: ${token ? "[OK] set (" + token.slice(0, 6) + "...)" : "[MISS] not set in .env"}`);
if (!token) {
  console.error("\nERROR: MAKE_MCP_TOKEN must be set in .env before patching. Aborting.");
  process.exit(1);
}

// ── 2. Read current action row ────────────────────────────────────────────────
const [actionRows] = await pool.query(
  `SELECT id, action_key, runtime_callable, primary_executor, runtime_capability_class,
          api_key_mode, api_key_storage_mode, secret_store_ref, api_key_value
   FROM \`actions\` WHERE action_key = 'make_mcp_server' LIMIT 1`
);

if (!actionRows.length) {
  console.error("\nERROR: No action found with action_key = 'make_mcp_server'. Create the action row first.");
  process.exit(1);
}

const row = actionRows[0];
console.log("\nCurrent action row:");
console.log(`  id:                      ${row.id}`);
console.log(`  runtime_callable:        ${row.runtime_callable}`);
console.log(`  primary_executor:        ${row.primary_executor}`);
console.log(`  runtime_capability_class:${row.runtime_capability_class}`);
console.log(`  api_key_mode:            ${row.api_key_mode}`);
console.log(`  api_key_storage_mode:    ${row.api_key_storage_mode}`);
console.log(`  secret_store_ref:        ${row.secret_store_ref}`);
console.log(`  api_key_value:           ${row.api_key_value ? "[PRESENT — will be NULLed]" : "NULL"}`);

// ── 3. Patch the action row ───────────────────────────────────────────────────
console.log("\n── Patch: actions table");
const targetValues = {
  runtime_callable: 1,
  primary_executor: "http_client_backend",
  runtime_capability_class: "mcp_connector",
  api_key_mode: "bearer_token",
  api_key_storage_mode: "secret_reference",
  secret_store_ref: "ref:secret:MAKE_MCP_TOKEN",
  api_key_value: null,
};

const changes = Object.entries(targetValues)
  .filter(([k, v]) => String(row[k] ?? "") !== String(v ?? ""))
  .map(([k, v]) => `${k}: ${JSON.stringify(row[k] ?? null)} → ${JSON.stringify(v)}`);

if (!changes.length) {
  console.log("  [SKIP] action row already up-to-date.");
} else {
  for (const c of changes) console.log(`  ${APPLY ? "[APPLY]" : "[DRY]  "} ${c}`);
  if (APPLY) {
    await pool.query(
      `UPDATE \`actions\`
       SET runtime_callable = 1,
           primary_executor = 'http_client_backend',
           runtime_capability_class = 'mcp_connector',
           api_key_mode = 'bearer_token',
           api_key_storage_mode = 'secret_reference',
           secret_store_ref = 'ref:secret:MAKE_MCP_TOKEN',
           api_key_value = NULL
       WHERE id = ?`,
      [row.id]
    );
    console.log("  [DONE] action row patched.");
  }
}

// ── 4. Patch connected_systems rows (if any) ──────────────────────────────────
console.log("\n── Patch: connected_systems with Make MCP");
const [csRows] = await pool.query(
  `SELECT system_id, system_key, connector_family
   FROM \`connected_systems\`
   WHERE (system_key LIKE '%make%mcp%' OR system_key LIKE '%make_mcp%'
          OR system_key = 'make_mcp_server')
     AND (connector_family IS NULL OR connector_family != 'make_mcp')
   LIMIT 20`
);

if (!csRows.length) {
  console.log("  [SKIP] No connected_systems rows need patching (none found or already correct).");
} else {
  for (const cs of csRows) {
    console.log(`  ${APPLY ? "[APPLY]" : "[DRY]  "} system_id=${cs.system_id} key=${cs.system_key}: connector_family=${cs.connector_family} → make_mcp`);
    if (APPLY) {
      await pool.query(
        "UPDATE `connected_systems` SET connector_family = 'make_mcp' WHERE system_id = ?",
        [cs.system_id]
      );
    }
  }
}

// ── 5. Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
if (APPLY) {
  console.log("Patch applied. make_mcp_server action is now runtime-callable.");
  console.log("connectorExecutor.dispatchPlan() will route plans with connector_family=make_mcp to dispatchMcpConnector().");
} else {
  console.log("Dry-run complete. Re-run with --apply to execute.");
}

await pool.end();
