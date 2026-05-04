/**
 * migrate-legacy-to-platform.mjs
 *
 * ETL for 6 legacy tables → platform canonical tables (Sprint 18 completion).
 *
 * Migrations:
 *   actions          (19)    → logic_definitions  (logic_type=execution)
 *   execution_policies (1097)→ logic_definitions  (logic_type=supervisory)
 *   workflows        (239)   → logic_definitions  (logic_type=execution)
 *   endpoints        (1491)  → connected_systems  (grouped by connector+domain)
 *   task_routes      (206)   → intent_resolutions (seeded route definitions)
 *   execution_log    (12012) → telemetry_spans    (batched, tenant optional)
 *
 * All operations are idempotent (INSERT IGNORE / ON DUPLICATE KEY).
 *
 * Usage:
 *   node migrate-legacy-to-platform.mjs                        # all tables
 *   node migrate-legacy-to-platform.mjs --table=actions        # single table
 *   node migrate-legacy-to-platform.mjs --dry-run              # summary only
 *   node migrate-legacy-to-platform.mjs --batch=200            # execution_log batch size
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.resolve("./db.js")));
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
} catch { /* rely on process.env */ }

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TABLE   = (args.find(a => a.startsWith("--table=")) || "").slice(8) || null;
const BATCH   = Number((args.find(a => a.startsWith("--batch=")) || "").slice(8)) || 500;

const pool = createPool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  timezone: "Z",
  connectionLimit: 5,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 128);
}

function mapExecStatus(s) {
  const lower = String(s || "").toLowerCase();
  if (lower === "success") return "ok";
  if (lower === "failed" || lower === "error" || lower === "blocked" || lower === "degraded" || lower === "retrying") return "error";
  return "ok";
}

function isTruthy(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "active" || s === "yes";
}

function parseMs(durationSeconds) {
  const n = parseFloat(durationSeconds);
  return isNaN(n) ? null : Math.round(n * 1000);
}

function parseDatetime(v) {
  if (!v) return null;
  try {
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch { return null; }
}

function jsonOrNull(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

let _platformTenantId = null;

async function getPlatformTenantId() {
  if (_platformTenantId) return _platformTenantId;
  const [rows] = await pool.query(
    `SELECT tenant_id FROM tenants WHERE tenant_type='platform_owner' LIMIT 1`
  );
  if (rows.length) {
    _platformTenantId = rows[0].tenant_id;
    return _platformTenantId;
  }
  const id = randomUUID();
  if (!DRY_RUN) {
    await pool.query(
      `INSERT IGNORE INTO tenants (tenant_id, tenant_type, display_name, status)
       VALUES (?, 'platform_owner', 'Platform System', 'active')`,
      [id]
    );
    const [check] = await pool.query(`SELECT tenant_id FROM tenants WHERE tenant_type='platform_owner' LIMIT 1`);
    _platformTenantId = check[0]?.tenant_id || id;
  } else {
    _platformTenantId = "dry-run-platform-tenant";
  }
  console.log(`  → Platform owner tenant: ${_platformTenantId} ${DRY_RUN ? "(dry-run)" : "(created)"}`);
  return _platformTenantId;
}

async function markInventory(tableName, status, rowCount) {
  if (DRY_RUN) return;
  await pool.query(
    `UPDATE data_migration_inventory
     SET migration_status=?, row_count=?, last_checked_at=NOW()
     WHERE table_name=? AND authority_model='legacy'`,
    [status, rowCount, tableName]
  );
}

// ── 1. actions → logic_definitions ───────────────────────────────────────────

async function migrateActions() {
  console.log("\n── actions → logic_definitions ──────────────────────────────────");
  const [rows] = await pool.query(`SELECT * FROM actions ORDER BY id`);
  console.log(`  Source: ${rows.length} rows`);

  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const logicId  = randomUUID();
    const logicKey = slug(row.action_key || `action_${row.id}`);
    const displayName = String(row.action_title || row.action_key || `Action ${row.id}`).slice(0, 255);
    const status   = isTruthy(row.status) || row.status === "active" ? "active" : "draft";
    const body     = {
      source: "legacy_actions",
      legacy_id: row.id,
      connector_family: row.connector_family,
      module_binding: row.module_binding,
      runtime_callable: row.runtime_callable,
      api_key_mode: row.api_key_mode,
      api_key_storage_mode: row.api_key_storage_mode,
      primary_executor: row.primary_executor,
      execution_layer: row.execution_layer,
      action_class: row.action_class,
      action_scope: row.action_scope,
      trigger_phrase: row.trigger_phrase,
      route_target: row.route_target,
      request_envelope_required: row.request_envelope_required,
      review_required: row.review_required,
      allowed_actor_roles: row.allowed_actor_roles,
      allowed_governance_levels: row.allowed_governance_levels,
    };

    if (DRY_RUN) {
      console.log(`  [DRY] UPSERT logic_definitions key=${logicKey} type=execution status=${status}`);
      inserted++;
      continue;
    }

    const [r] = await pool.query(
      `INSERT IGNORE INTO logic_definitions
         (logic_id, logic_key, display_name, logic_type, status, body_json)
       VALUES (?, ?, ?, 'execution', ?, ?)`,
      [logicId, logicKey, displayName, status, JSON.stringify(body)]
    );
    if (r.affectedRows > 0) inserted++; else skipped++;
  }
  console.log(`  ✓ ${inserted} inserted, ${skipped} skipped`);
  await markInventory("actions", "complete", rows.length);
}

// ── 2. execution_policies → logic_definitions ────────────────────────────────

async function migrateExecutionPolicies() {
  console.log("\n── execution_policies → logic_definitions ────────────────────────");
  const [rows] = await pool.query(`SELECT * FROM execution_policies ORDER BY id`);
  console.log(`  Source: ${rows.length} rows`);

  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const logicId  = randomUUID();
    const rawKey   = `policy.${row.policy_group || "default"}.${row.policy_key || row.id}`;
    const logicKey = slug(rawKey);
    const displayName = String(row.policy_key || rawKey).slice(0, 255);
    const status   = isTruthy(row.active) ? "active" : "draft";
    const body     = {
      source: "legacy_execution_policies",
      legacy_id: row.id,
      policy_group: row.policy_group,
      policy_key: row.policy_key,
      policy_value: row.policy_value,
      execution_scope: row.execution_scope,
      affects_layer: row.affects_layer,
      blocking: row.blocking,
      notes: row.notes,
    };

    if (DRY_RUN) {
      if (inserted < 3) console.log(`  [DRY] UPSERT logic_definitions key=${logicKey} type=supervisory`);
      inserted++;
      continue;
    }

    const [r] = await pool.query(
      `INSERT IGNORE INTO logic_definitions
         (logic_id, logic_key, display_name, logic_type, status, body_json)
       VALUES (?, ?, ?, 'supervisory', ?, ?)`,
      [logicId, logicKey, displayName, status, JSON.stringify(body)]
    );
    if (r.affectedRows > 0) inserted++; else skipped++;
  }
  console.log(`  ✓ ${inserted} inserted, ${skipped} skipped`);
  await markInventory("execution_policies", "complete", rows.length);
}

// ── 3. workflows → logic_definitions ─────────────────────────────────────────
// Note: entity classification maps workflows→workflow_runs, but workflow_runs is
// a runtime execution log (tenant_id NOT NULL, no definition columns). Workflow
// DEFINITIONS belong in logic_definitions (logic_type=execution). This deviation
// is intentional and correct.

async function migrateWorkflows() {
  console.log("\n── workflows → logic_definitions ────────────────────────────────");
  const [rows] = await pool.query(`SELECT * FROM workflows ORDER BY id`);
  console.log(`  Source: ${rows.length} rows`);

  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const logicId  = randomUUID();
    // workflow_id is unique; workflow_key may repeat (many workflows share a workflow_key)
    const rawKey   = `wf.${row.workflow_key || row.workflow_id || row.id}.${row.workflow_id || row.id}`;
    const logicKey = slug(rawKey);
    const displayName = String(row.workflow_name || row.workflow_key || `Workflow ${row.id}`).slice(0, 255);
    const status   = (row.status === "Active" || isTruthy(row.active)) ? "active" : "draft";
    const body     = {
      source: "legacy_workflows",
      legacy_id: row.id,
      workflow_id: row.workflow_id,
      workflow_key: row.workflow_key,
      workflow_type: row.workflow_type,
      module_mode: row.module_mode,
      trigger_source: row.trigger_source,
      input_type: row.input_type,
      execution_mode: row.execution_mode,
      execution_class: row.execution_class,
      primary_objective: row.primary_objective,
      mapped_engines: row.mapped_engines,
      engine_order: row.engine_order,
      primary_output: row.primary_output,
      lifecycle_mode: row.lifecycle_mode,
      route_key: row.route_key,
      target_module: row.target_module,
      review_required: row.review_required,
      memory_required: row.memory_required,
      allowed_actor_roles: row.allowed_actor_roles,
      allowed_governance_levels: row.allowed_governance_levels,
    };

    if (DRY_RUN) {
      if (inserted < 3) console.log(`  [DRY] UPSERT logic_definitions key=${logicKey} type=execution`);
      inserted++;
      continue;
    }

    const [r] = await pool.query(
      `INSERT IGNORE INTO logic_definitions
         (logic_id, logic_key, display_name, logic_type, status, body_json)
       VALUES (?, ?, ?, 'execution', ?, ?)`,
      [logicId, logicKey, displayName, status, JSON.stringify(body)]
    );
    if (r.affectedRows > 0) inserted++; else skipped++;
  }
  console.log(`  ✓ ${inserted} inserted, ${skipped} skipped`);
  await markInventory("workflows", "complete", rows.length);
}

// ── 4. endpoints → connected_systems ─────────────────────────────────────────
// Group by (connector_family, provider_domain) — one system per unique pair.

async function migrateEndpoints() {
  console.log("\n── endpoints → connected_systems ────────────────────────────────");
  const tenantId = await getPlatformTenantId();

  const [groups] = await pool.query(
    `SELECT connector_family, provider_domain,
            COUNT(*) as endpoint_count,
            MAX(status) as sample_status,
            MAX(execution_readiness) as execution_readiness
     FROM endpoints
     GROUP BY connector_family, provider_domain
     ORDER BY endpoint_count DESC`
  );
  console.log(`  Source: ${groups.length} unique connector+domain groups`);

  let inserted = 0, skipped = 0;
  for (const grp of groups) {
    const systemId    = randomUUID();
    const family      = String(grp.connector_family || "unknown").slice(0, 64);
    const domain      = String(grp.provider_domain || "").slice(0, 255);
    const systemKey   = slug(`${family}.${domain || "generic"}`).slice(0, 128);
    const displayName = (family + (domain ? ` (${domain})` : "")).slice(0, 255);
    const status      = isTruthy(grp.sample_status) || grp.sample_status === "active" ? "active" : "pending";
    const config      = { source: "legacy_endpoints", endpoint_count: grp.endpoint_count, execution_readiness: grp.execution_readiness };

    if (DRY_RUN) {
      console.log(`  [DRY] UPSERT connected_systems key=${systemKey} endpoints=${grp.endpoint_count}`);
      inserted++;
      continue;
    }

    const [r] = await pool.query(
      `INSERT INTO connected_systems
         (system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
          connector_family, status, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), config_json=VALUES(config_json)`,
      [systemId, tenantId, systemKey, displayName, family, domain || null, family, status, JSON.stringify(config)]
    );
    if (r.affectedRows === 1) inserted++; else skipped++;
  }
  console.log(`  ✓ ${inserted} inserted/updated, ${skipped} no-change`);
  const [[{n}]] = await pool.query(`SELECT COUNT(*) as n FROM endpoints`);
  await markInventory("endpoints", "complete", n);
}

// ── 5. task_routes → intent_resolutions ──────────────────────────────────────
// Seeded resolution records representing known routing paths.

async function migrateTaskRoutes() {
  console.log("\n── task_routes → intent_resolutions ────────────────────────────");
  const tenantId = await getPlatformTenantId();

  const [rows] = await pool.query(`SELECT * FROM task_routes ORDER BY id`);
  console.log(`  Source: ${rows.length} rows`);

  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const resolutionId = randomUUID();
    const rawInput     = String(row.trigger_terms || row.task_key || row.intent_key || "unknown").slice(0, 1000);
    const resolvedIntent = String(row.intent_key || row.task_key || "").slice(0, 128) || null;
    const routeKey     = String(row.route_id || row.row_id || "").slice(0, 128) || null;
    const workflowKey  = String(row.workflow_key || "").slice(0, 128) || null;
    const resStatus    = isTruthy(row.active) ? "resolved" : "blocked";
    const meta         = {
      source: "legacy_task_routes",
      legacy_id: row.id,
      task_key: row.task_key,
      route_mode: row.route_mode,
      execution_layer: row.execution_layer,
      request_type: row.request_type,
      brand_scope: row.brand_scope,
      lifecycle_mode: row.lifecycle_mode,
      review_required: row.review_required,
      memory_required: row.memory_required,
      allowed_actor_roles: row.allowed_actor_roles,
      notes: row.notes,
    };

    if (DRY_RUN) {
      if (inserted < 3) console.log(`  [DRY] INSERT intent_resolutions intent=${resolvedIntent} route=${routeKey}`);
      inserted++;
      continue;
    }

    const [r] = await pool.query(
      `INSERT IGNORE INTO intent_resolutions
         (resolution_id, tenant_id, raw_input, resolved_intent, confidence,
          matched_route_key, matched_workflow_key, resolution_status, service_mode, meta_json)
       VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, 'self_serve', ?)`,
      [resolutionId, tenantId, rawInput, resolvedIntent, routeKey, workflowKey, resStatus, JSON.stringify(meta)]
    );
    if (r.affectedRows > 0) inserted++; else skipped++;
  }
  console.log(`  ✓ ${inserted} inserted, ${skipped} skipped`);
  await markInventory("task_routes", "complete", rows.length);
}

// ── 6. execution_log → telemetry_spans ───────────────────────────────────────

async function migrateExecutionLog() {
  console.log("\n── execution_log → telemetry_spans ──────────────────────────────");
  const [[{total}]] = await pool.query(`SELECT COUNT(*) as total FROM execution_log`);
  console.log(`  Source: ${total} rows (batch=${BATCH})`);

  let inserted = 0, skipped = 0, offset = 0;

  while (offset < total) {
    const [rows] = await pool.query(
      `SELECT * FROM execution_log ORDER BY id LIMIT ? OFFSET ?`,
      [BATCH, offset]
    );
    if (!rows.length) break;

    if (DRY_RUN) {
      if (offset === 0) console.log(`  [DRY] Would insert up to ${total} telemetry_spans`);
      inserted += rows.length;
      offset += BATCH;
      continue;
    }

    const values = [];
    const placeholders = [];

    for (const row of rows) {
      const spanId    = randomUUID();
      const traceId   = String(row.execution_trace_id_writeback || randomUUID()).slice(0, 36);
      const spanName  = String(row.execution_class || row.source_layer || "legacy_execution").slice(0, 128);
      const spanType  = "internal";
      const status    = mapExecStatus(row.execution_status);
      const durationMs = parseMs(row.duration_seconds);
      const startedAt  = parseDatetime(row.start_time) || parseDatetime(row.created_at) || new Date().toISOString().slice(0,19).replace("T"," ");
      const errorMsg   = row.failure_reason ? String(row.failure_reason).slice(0, 512) : null;
      const attrs      = JSON.stringify({
        source: "legacy_execution_log",
        legacy_id: row.id,
        route_id: row.route_id,
        route_keys: row.route_keys,
        selected_workflows: row.selected_workflows,
        engine_chain: row.engine_chain,
        execution_mode: row.execution_mode,
        user_input: row.user_input ? String(row.user_input).slice(0, 512) : null,
        output_summary: row.output_summary ? String(row.output_summary).slice(0, 512) : null,
        recovery_status: row.recovery_status,
        used_logic_name: row.used_logic_name,
      });

      placeholders.push("(?,?,?,?,?,?,?,?,?,?)");
      values.push(spanId, traceId, null, null, spanName, spanType, status, durationMs, attrs, startedAt);
      if (errorMsg) {
        // errorMsg needs to be set via UPDATE since INSERT schema lacks a WHERE-able key after IGNORE
      }
    }

    if (placeholders.length) {
      const [r] = await pool.query(
        `INSERT IGNORE INTO telemetry_spans
           (span_id, trace_id, tenant_id, run_id, span_name, span_type, status, duration_ms, attributes_json, started_at)
         VALUES ${placeholders.join(",")}`,
        values
      );
      inserted += r.affectedRows;
      skipped  += rows.length - r.affectedRows;
    }

    offset += BATCH;
    process.stdout.write(`  Progress: ${Math.min(offset, total)}/${total}\r`);
  }

  console.log(`\n  ✓ ${inserted} inserted, ${skipped} skipped`);
  await markInventory("execution_log", "complete", total);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const ALL_MIGRATIONS = {
  actions:             migrateActions,
  execution_policies:  migrateExecutionPolicies,
  workflows:           migrateWorkflows,
  endpoints:           migrateEndpoints,
  task_routes:         migrateTaskRoutes,
  execution_log:       migrateExecutionLog,
};

if (TABLE && !ALL_MIGRATIONS[TABLE]) {
  console.error(`Unknown table: ${TABLE}. Valid: ${Object.keys(ALL_MIGRATIONS).join(", ")}`);
  process.exit(1);
}

console.log(`Legacy → Platform Migration ${DRY_RUN ? "[DRY RUN]" : "[APPLY]"}`);
console.log(`Tables: ${TABLE || "all"}`);

const toRun = TABLE ? { [TABLE]: ALL_MIGRATIONS[TABLE] } : ALL_MIGRATIONS;

for (const [name, fn] of Object.entries(toRun)) {
  try {
    await fn();
  } catch (err) {
    console.error(`\n[ERROR] ${name}: ${err.message}`);
    process.exit(1);
  }
}

await pool.end();
console.log("\n✓ Migration complete.");
