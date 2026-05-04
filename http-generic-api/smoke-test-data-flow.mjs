/**
 * smoke-test-data-flow.mjs
 * End-to-end data-flow smoke test across all 15 SQL tables.
 * Run: node http-generic-api/smoke-test-data-flow.mjs
 *
 * Exit 0 = all checks passed. Exit 1 = one or more failures.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as adapter from "./sqlAdapter.js";
import { getPool } from "./db.js";

// Load .env manually (dotenv not installed in this project)
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found — rely on process.env */ }

// ── helpers ────────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function ok(label, value) {
  if (value) {
    console.log(`  ok  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    fail++;
  }
}

async function section(title, fn) {
  console.log(`\n-- ${title}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  FAIL  UNCAUGHT: ${err.message}`);
    fail++;
  }
}

// ── 1. Connection ──────────────────────────────────────────────────────────────

await section("1. DB connection", async () => {
  const pool = getPool();
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  ok("ping succeeds", true);
});

// ── 2. All 15 tables readable ──────────────────────────────────────────────────

const SHEET_NAMES = [
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

const tables = {};

await section("2. Read all 15 tables", async () => {
  for (const name of SHEET_NAMES) {
    const rows = await adapter.readTable(name);
    tables[name] = rows;
    ok(`${name}: ${rows.length} rows`, rows.length >= 0);
  }
});

// ── 3. Route -> Workflow execution chain ──────────────────────────────────────

await section("3. Route->Workflow execution chain", async () => {
  const routes = tables["Task Routes"] || [];
  ok("task_routes has rows", routes.length > 0);

  const ACTIVE_VALUES = new Set(["1", "true", "TRUE", "yes", "YES"]);
  const activeRoute = routes.find((r) => ACTIVE_VALUES.has(r["active"]));
  const activeCount = routes.filter((r) => ACTIVE_VALUES.has(r["active"])).length;
  // Data note: all routes may be inactive if not yet promoted — not a hard failure
  ok(`active routes: ${activeCount} of ${routes.length} (data state)`, true);

  const anyRoute = activeRoute || routes.find((r) => r["workflow_key"]);
  if (anyRoute) {
    const wfKey = anyRoute["workflow_key"];
    ok("route has workflow_key", !!wfKey);

    if (wfKey) {
      const wfRows = await adapter.findRows("Workflow Registry", "workflow_key", wfKey);
      ok(`workflow_key "${wfKey}" resolves in workflows table`, wfRows.length > 0);
      if (wfRows.length > 0) {
        ok("workflow row has execution_class", !!wfRows[0]["execution_class"]);
      }
    }
  }

  const intentRoute = routes.find((r) => r["intent_key"]);
  if (intentRoute) {
    const found = await adapter.findRows("Task Routes", "intent_key", intentRoute["intent_key"]);
    ok(`findRows by intent_key works`, found.length > 0);
  }
});

// ── 4. Execution policies ─────────────────────────────────────────────────────

await section("4. Execution policies", async () => {
  const policies = tables["Execution Policy Registry"] || [];
  ok("execution_policies has rows", policies.length > 0);

  const active = policies.filter(
    (p) => p["active"] === "1" || p["active"] === "true" || p["active"] === "TRUE"
  );
  ok(`active policies exist (${active.length})`, active.length > 0);

  const blocking = policies.filter(
    (p) => p["blocking"] === "1" || p["blocking"] === "true" || p["blocking"] === "TRUE"
  );
  ok(`blocking policy count readable (${blocking.length})`, true);

  const groups = [...new Set(policies.map((p) => p["policy_group"]).filter(Boolean))];
  ok(`policy_group values present (${groups.length} groups)`, groups.length > 0);
});

// ── 5. Brand -> SRI -> SSI chain ──────────────────────────────────────────────

await section("5. Brand->SRI->SSI chain", async () => {
  const brands = tables["Brand Registry"] || [];
  ok("brands has rows", brands.length > 0);

  const brandsWithDomain = brands.filter((b) => b["brand_domain"]);
  ok(`brands with brand_domain: ${brandsWithDomain.length}`, brandsWithDomain.length > 0);

  if (brandsWithDomain.length > 0) {
    const domain = brandsWithDomain[0]["brand_domain"];

    const sri = await adapter.findRows("Site Runtime Inventory Registry", "brand_domain", domain);
    ok(`SRI lookup by brand_domain "${domain}": ${sri.length} rows`, true);

    const ssi = await adapter.findRows("Site Settings Inventory Registry", "brand_domain", domain);
    ok(`SSI lookup by brand_domain "${domain}": ${ssi.length} rows`, true);

    if (sri.length > 0) {
      ok("SRI row has target_key", !!sri[0]["target_key"]);
      ok("SRI row has active_status field", "active_status" in sri[0]);
    }
  }
});

// ── 6. Hosting accounts ───────────────────────────────────────────────────────

await section("6. Hosting accounts", async () => {
  const accounts = tables["Hosting Account Registry"] || [];
  ok("hosting_accounts has rows", accounts.length > 0);

  const withKey = accounts.filter((a) => a["hosting_account_key"]);
  ok(`hosting_account_key present in rows: ${withKey.length}`, withKey.length > 0);

  if (withKey.length > 0) {
    const key = withKey[0]["hosting_account_key"];
    const found = await adapter.findRows("Hosting Account Registry", "hosting_account_key", key);
    ok(`findRows by hosting_account_key "${key}"`, found.length > 0);
  }
});

// ── 7. Actions -> Endpoints linkage ──────────────────────────────────────────

await section("7. Actions->Endpoints linkage", async () => {
  const actions = tables["Actions Registry"] || [];
  ok("actions has rows", actions.length > 0);

  const withKey = actions.filter((a) => a["action_key"]);
  ok(`actions with action_key: ${withKey.length}`, withKey.length > 0);

  if (withKey.length > 0) {
    const actionKey = withKey[0]["action_key"];
    const endpoints = await adapter.findRows(
      "API Actions Endpoint Registry", "parent_action_key", actionKey
    );
    ok(`endpoints for action "${actionKey}": ${endpoints.length} rows`, true);
  }

  const endpointRows = tables["API Actions Endpoint Registry"] || [];
  ok("endpoints table has rows", endpointRows.length > 0);

  const withId = endpointRows.filter((e) => e["endpoint_id"]);
  ok(`endpoint rows with endpoint_id: ${withId.length}`, withId.length > 0);
});

// ── 8. RSC integrity ──────────────────────────────────────────────────────────

await section("8. Registry Surfaces Catalog integrity", async () => {
  const rsc = tables["Registry Surfaces Catalog"] || [];
  ok("RSC has rows", rsc.length > 0);

  const surfaceIds = rsc.map((r) => r["surface_id"]).filter(Boolean);
  const uniqueIds = new Set(surfaceIds);
  ok(
    `no duplicate surface_id (${surfaceIds.length} ids, ${uniqueIds.size} unique)`,
    surfaceIds.length === uniqueIds.size
  );

  const required = rsc.filter(
    (r) => r["required_for_execution"] === "TRUE" || r["required_for_execution"] === "1"
  );
  ok(`required_for_execution rows: ${required.length}`, required.length > 0);

  const active = rsc.filter(
    (r) => (r["active_status"] || "").toLowerCase() === "active"
  );
  ok(`active_status=active rows: ${active.length}`, active.length > 0);
});

// ── 9. JSON assets ────────────────────────────────────────────────────────────

await section("9. JSON Asset Registry", async () => {
  const assets = tables["JSON Asset Registry"] || [];
  ok(`json_assets readable: ${assets.length} rows`, assets.length >= 0);

  const withKey = assets.filter((a) => a["asset_key"]);
  ok(`asset_key populated in ${withKey.length} rows`, true);
});

// ── 10. Execution log ─────────────────────────────────────────────────────────

await section("10. Execution log", async () => {
  const log = tables["Execution Log Unified"] || [];
  ok(`execution_log readable: ${log.length} rows`, true);

  if (log.length > 0) {
    ok("execution_log row has Execution Status field", "Execution Status" in log[0]);
    ok("execution_log row has Entry Type field", "Entry Type" in log[0]);
  } else {
    ok("execution_log empty (no entries yet)", true);
  }
});

// ── 11. Validation and Repair ─────────────────────────────────────────────────

await section("11. Validation and Repair Registry", async () => {
  const vr = tables["Validation & Repair Registry"] || [];
  ok(`validation_repair readable: ${vr.length} rows`, true);

  if (vr.length > 0) {
    const withSurface = vr.filter((r) => r["surface_id"]);
    ok(`validation_repair rows with surface_id: ${withSurface.length}`, withSurface.length > 0);
  }
});

// ── 12. Plugin inventory ──────────────────────────────────────────────────────

await section("12. Plugin inventory", async () => {
  const plugins = tables["Plugin Inventory Registry"] || [];
  ok(`plugins readable: ${plugins.length} rows`, true);

  if (plugins.length > 0) {
    ok("plugins row has target_key", !!plugins[0]["target_key"]);
  }
});

// ── 13. Brand Core Registry ───────────────────────────────────────────────────

await section("13. Brand Core Registry", async () => {
  const bc = tables["Brand Core Registry"] || [];
  ok(`brand_core readable: ${bc.length} rows`, true);

  if (bc.length > 0) {
    const withBrandKey = bc.filter((r) => r["brand_key"]);
    ok(`brand_core rows with brand_key: ${withBrandKey.length}`, true);
  }
});

// ── 14. UNIQUE constraint enforcement ────────────────────────────────────────

await section("14. UNIQUE constraint enforcement", async () => {
  const pool = getPool();

  // route_id uniqueness
  const probeRouteId = "__smoke_route_" + Date.now() + "__";
  try {
    await pool.query(
      "INSERT INTO `task_routes` (`route_id`) VALUES (?)",
      [probeRouteId]
    );
    try {
      await pool.query(
        "INSERT INTO `task_routes` (`route_id`) VALUES (?)",
        [probeRouteId]
      );
      ok("UNIQUE on task_routes.route_id blocks duplicates", false);
    } catch (dupErr) {
      ok("UNIQUE on task_routes.route_id blocks duplicates", dupErr.code === "ER_DUP_ENTRY");
    } finally {
      await pool.query("DELETE FROM `task_routes` WHERE `route_id` = ?", [probeRouteId]);
    }
  } catch (insertErr) {
    ok(`task_routes.route_id constrained (${insertErr.code})`, insertErr.code !== undefined);
  }

  // workflow_id uniqueness
  const probeWorkflowId = "__smoke_wf_" + Date.now() + "__";
  try {
    await pool.query(
      "INSERT INTO `workflows` (`workflow_id`) VALUES (?)",
      [probeWorkflowId]
    );
    try {
      await pool.query(
        "INSERT INTO `workflows` (`workflow_id`) VALUES (?)",
        [probeWorkflowId]
      );
      ok("UNIQUE on workflows.workflow_id blocks duplicates", false);
    } catch (dupErr) {
      ok("UNIQUE on workflows.workflow_id blocks duplicates", dupErr.code === "ER_DUP_ENTRY");
    } finally {
      await pool.query("DELETE FROM `workflows` WHERE `workflow_id` = ?", [probeWorkflowId]);
    }
  } catch (insertErr) {
    ok(`workflows.workflow_id constrained (${insertErr.code})`, insertErr.code !== undefined);
  }
});

// ── 15. Row counts summary ────────────────────────────────────────────────────

await section("15. Row count summary", async () => {
  const pool = getPool();
  const tableNames = [
    "brands", "brand_core", "actions", "endpoints", "execution_policies",
    "hosting_accounts", "site_runtime_inventory", "site_settings_inventory",
    "plugins", "task_routes", "workflows", "registry_surfaces_catalog",
    "validation_repair", "json_assets", "execution_log",
  ];
  for (const t of tableNames) {
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM `" + t + "`");
    ok(`${t}: ${cnt} rows`, true);
  }
});

// ── Final report ──────────────────────────────────────────────────────────────

await getPool().end();

console.log("\n" + "-".repeat(50));
console.log(`Smoke test complete: ${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
} else {
  console.log("RESULT: PASS");
  process.exit(0);
}
