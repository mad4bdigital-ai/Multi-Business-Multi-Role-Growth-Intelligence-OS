/**
 * tighten-db.mjs
 *
 * Deduplicates natural keys, adds UNIQUE constraints + indexes,
 * and converts TEXT → VARCHAR on key lookup columns.
 *
 * Usage:
 *   node tighten-db.mjs            # dry-run (report what would change)
 *   node tighten-db.mjs --apply    # execute
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getPool } from "./db.js";

// ── Load .env manually ─────────────────────────────────────────────────────────
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

const APPLY = process.argv.includes("--apply");

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Execute SQL only when --apply is set, otherwise report what would run. */
async function exec(pool, sql, label) {
  if (APPLY) {
    const [result] = await pool.query(sql);
    return result;
  }
  console.log(`  [DRY-RUN] Would run: ${label || sql.slice(0, 120)}`);
  return null;
}

/** Wrap an ALTER TABLE in try/catch so existing keys don't abort the script. */
async function tryAlter(pool, sql, label) {
  try {
    const result = await exec(pool, sql, label);
    if (APPLY) console.log(`  OK: ${label}`);
    return result;
  } catch (err) {
    const msg = err.message || String(err);
    if (
      msg.includes("Duplicate key name") ||
      msg.includes("already exists") ||
      msg.includes("Multiple primary key defined")
    ) {
      console.log(`  SKIP (already exists): ${label}`);
    } else {
      console.warn(`  WARN on "${label}": ${msg}`);
    }
    return null;
  }
}

// ── A. Deduplication ───────────────────────────────────────────────────────────

/**
 * Count and optionally delete duplicates for a single-column natural key.
 * Keeps the row with MIN(id) per key value.
 */
async function dedupSingle(pool, table, keyCol) {
  console.log(`\n[dedup] ${table}.${keyCol}`);

  const [[{ dupCount }]] = await pool.query(
    `SELECT COUNT(*) AS dupCount FROM \`${table}\`
     WHERE \`${keyCol}\` IS NOT NULL AND \`${keyCol}\` != ''
       AND id NOT IN (
         SELECT min_id FROM (
           SELECT MIN(id) AS min_id FROM \`${table}\`
           WHERE \`${keyCol}\` IS NOT NULL AND \`${keyCol}\` != ''
           GROUP BY \`${keyCol}\`
         ) t
       )`
  );
  console.log(`  Duplicate rows to remove: ${dupCount}`);

  if (dupCount > 0) {
    const deleteSql =
      `DELETE FROM \`${table}\` WHERE id NOT IN (` +
      `  SELECT min_id FROM (` +
      `    SELECT MIN(id) AS min_id FROM \`${table}\`` +
      `    WHERE \`${keyCol}\` IS NOT NULL AND \`${keyCol}\` != ''` +
      `    GROUP BY \`${keyCol}\`` +
      `  ) t` +
      `) AND \`${keyCol}\` IS NOT NULL AND \`${keyCol}\` != ''`;
    await exec(pool, deleteSql, `DELETE dupes in ${table} by ${keyCol} (${dupCount} rows)`);
  }
}

/**
 * Count and optionally delete duplicates for a composite (two-column) natural key.
 * Skips rows where BOTH key columns are blank.
 */
async function dedupComposite(pool, table, col1, col2) {
  console.log(`\n[dedup] ${table}.(${col1}, ${col2})`);

  const [[{ dupCount }]] = await pool.query(
    `SELECT COUNT(*) AS dupCount FROM \`${table}\`
     WHERE NOT (\`${col1}\` IS NULL OR \`${col1}\` = '' AND \`${col2}\` IS NULL OR \`${col2}\` = '')
       AND id NOT IN (
         SELECT min_id FROM (
           SELECT MIN(id) AS min_id FROM \`${table}\`
           WHERE NOT (\`${col1}\` IS NULL OR \`${col1}\` = '' AND \`${col2}\` IS NULL OR \`${col2}\` = '')
           GROUP BY \`${col1}\`, \`${col2}\`
         ) t
       )`
  );
  console.log(`  Duplicate rows to remove: ${dupCount}`);

  if (dupCount > 0) {
    const blankFilter =
      `NOT (\`${col1}\` IS NULL OR \`${col1}\` = '' AND \`${col2}\` IS NULL OR \`${col2}\` = '')`;
    const deleteSql =
      `DELETE FROM \`${table}\` WHERE id NOT IN (` +
      `  SELECT min_id FROM (` +
      `    SELECT MIN(id) AS min_id FROM \`${table}\`` +
      `    WHERE ${blankFilter}` +
      `    GROUP BY \`${col1}\`, \`${col2}\`` +
      `  ) t` +
      `) AND ${blankFilter}`;
    await exec(
      pool,
      deleteSql,
      `DELETE dupes in ${table} by (${col1},${col2}) (${dupCount} rows)`
    );
  }
}

async function runDeduplication(pool) {
  console.log("\n===== A. Deduplication =====");
  await dedupSingle(pool, "task_routes", "route_id");
  await dedupSingle(pool, "workflows", "workflow_id");
  await dedupSingle(pool, "endpoints", "endpoint_id");
  await dedupComposite(pool, "execution_policies", "policy_group", "policy_key");
  await dedupComposite(pool, "brand_core", "brand_key", "asset_key");
}

// ── B. UNIQUE Constraints ──────────────────────────────────────────────────────

async function addUniqueConstraints(pool) {
  console.log("\n===== B. UNIQUE Constraints =====");
  await tryAlter(
    pool,
    "ALTER TABLE `task_routes` ADD UNIQUE KEY `uq_route_id` (`route_id`)",
    "task_routes: UNIQUE(route_id)"
  );
  await tryAlter(
    pool,
    "ALTER TABLE `workflows` ADD UNIQUE KEY `uq_workflow_id` (`workflow_id`)",
    "workflows: UNIQUE(workflow_id)"
  );
  await tryAlter(
    pool,
    "ALTER TABLE `endpoints` ADD UNIQUE KEY `uq_endpoint_id` (`endpoint_id`)",
    "endpoints: UNIQUE(endpoint_id)"
  );
  await tryAlter(
    pool,
    "ALTER TABLE `execution_policies` ADD UNIQUE KEY `uq_policy` (`policy_group`, `policy_key`)",
    "execution_policies: UNIQUE(policy_group, policy_key)"
  );
  await tryAlter(
    pool,
    "ALTER TABLE `brand_core` ADD UNIQUE KEY `uq_brand_asset` (`brand_key`, `asset_key`)",
    "brand_core: UNIQUE(brand_key, asset_key)"
  );
}

// ── C. Indexes ─────────────────────────────────────────────────────────────────

async function addIndexes(pool) {
  console.log("\n===== C. Indexes =====");
  const idxDefs = [
    ["task_routes", "idx_intent_key", "(`intent_key`)"],
    ["task_routes", "idx_active", "(`active`)"],
    ["task_routes", "idx_brand_scope", "(`brand_scope`)"],
    ["workflows", "idx_workflow_active", "(`active`)"],
    ["workflows", "idx_workflow_id", "(`workflow_id`)"],
    ["brands", "idx_brand_name", "(`brand_name`)"],
    ["brands", "idx_maturity", "(`maturity`(50))"],
    ["registry_surfaces_catalog", "idx_active_status", "(`active_status`)"],
    ["validation_repair", "idx_result_state", "(`result_state`(100))"],
    ["validation_repair", "idx_severity", "(`severity`(100))"],
  ];

  for (const [table, idxName, cols] of idxDefs) {
    await tryAlter(
      pool,
      `ALTER TABLE \`${table}\` ADD INDEX \`${idxName}\` ${cols}`,
      `${table}: ADD INDEX ${idxName}`
    );
  }
}

// ── D. TEXT → VARCHAR Conversions ──────────────────────────────────────────────

async function convertColumns(pool) {
  console.log("\n===== D. TEXT → VARCHAR Conversions =====");
  const colDefs = [
    ["registry_surfaces_catalog", "file_id", "VARCHAR(255) DEFAULT NULL"],
    ["registry_surfaces_catalog", "source_surface_id", "VARCHAR(255) DEFAULT NULL"],
    ["registry_surfaces_catalog", "parent_surface_id", "VARCHAR(255) DEFAULT NULL"],
    ["actions", "action_id", "VARCHAR(255) DEFAULT NULL"],
    ["validation_repair", "validation_type", "VARCHAR(100) DEFAULT NULL"],
    ["validation_repair", "result_state", "VARCHAR(100) DEFAULT NULL"],
    ["validation_repair", "severity", "VARCHAR(100) DEFAULT NULL"],
    ["validation_repair", "rule_id", "VARCHAR(255) DEFAULT NULL"],
  ];

  for (const [table, col, typeDef] of colDefs) {
    await tryAlter(
      pool,
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`${col}\` ${typeDef}`,
      `${table}.${col}: MODIFY to ${typeDef}`
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\ntighten-db.mjs — mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const pool = getPool();

  await runDeduplication(pool);
  await addUniqueConstraints(pool);
  await addIndexes(pool);
  await convertColumns(pool);

  console.log("\n===== Done =====");
  if (!APPLY) {
    console.log("\nRe-run with --apply to execute the changes.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[tighten-db] Fatal:", err.message || err);
  process.exit(1);
});
