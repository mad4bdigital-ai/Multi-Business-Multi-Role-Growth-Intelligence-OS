/**
 * tenantBrandBridge.mjs — Sprint 18: Data Hardening
 *
 * Bridges the legacy `brands` table into the new platform tenant model.
 * For each distinct brand in the brands table that has no matching tenant,
 * it provisions:
 *   1. A `tenants` row (type = 'brand', display_name = brand name)
 *   2. A `connected_systems` row linking the brand's connector family
 *   3. A `workspace_registry` row with bootstrap_status = 'ready'
 *   4. A default `subscriptions` row on the 'starter' plan
 *
 * Safe to re-run — all inserts are INSERT IGNORE or existence-checked.
 *
 * Usage:
 *   node tenantBrandBridge.mjs              # dry-run (preview only)
 *   node tenantBrandBridge.mjs --apply      # write to DB
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createPool } from "mysql2/promise";
import { randomUUID } from "node:crypto";

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

async function main() {
  const pool = createPool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    timezone: "Z",
  });

  console.log(`Mode: ${APPLY ? "APPLY (writing to DB)" : "DRY-RUN (no writes)"}\n`);

  // Load distinct brands
  const [brands] = await pool.query(
    `SELECT DISTINCT
       COALESCE(NULLIF(TRIM(normalized_brand_name), ''), NULLIF(TRIM(brand_name), '')) AS brand_key,
       COALESCE(NULLIF(TRIM(brand_name), ''), 'Unknown Brand') AS display_name,
       NULLIF(TRIM(brand_domain), '') AS brand_domain,
       NULLIF(TRIM(auth_type), '') AS auth_type,
       NULLIF(TRIM(transport_action_key), '') AS transport_action_key,
       NULLIF(TRIM(target_key), '') AS target_key
     FROM \`brands\`
     WHERE TRIM(brand_name) != ''
     ORDER BY brand_key`
  );

  console.log(`Found ${brands.length} brand(s) in legacy brands table.\n`);

  // Get starter plan_id
  const [[starterPlan]] = await pool.query(
    "SELECT plan_id FROM `plans` WHERE plan_key = 'starter' LIMIT 1"
  );
  if (!starterPlan) {
    console.error("ERROR: 'starter' plan not found. Run: node migrate-platform-tables.mjs --seed");
    await pool.end();
    process.exit(1);
  }
  const starter_plan_id = starterPlan.plan_id;

  let created = 0;
  let skipped = 0;

  for (const brand of brands) {
    const { brand_key, display_name, brand_domain, auth_type, transport_action_key, target_key } = brand;
    const connector_family = auth_type === "basic_auth_app_password" ? "wordpress" : (auth_type || "generic");
    if (!brand_key) { skipped++; continue; }

    // Check if tenant already exists for this brand_key (stored in metadata_json)
    const [existing] = await pool.query(
      `SELECT tenant_id FROM \`tenants\` WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.brand_key')) = ? LIMIT 1`,
      [brand_key]
    );

    if (existing.length) {
      console.log(`  SKIP  "${display_name}" — tenant ${existing[0].tenant_id} already exists`);
      skipped++;
      continue;
    }

    const tenant_id   = randomUUID();
    const workspace_id = randomUUID();
    const system_id    = randomUUID();
    const sub_id       = randomUUID();
    const metadata = JSON.stringify({ brand_key, brand_domain, source: "tenantBrandBridge", migrated_at: new Date().toISOString() });

    console.log(`  CREATE tenant for "${display_name}" (${brand_key})`);
    console.log(`         tenant_id=${tenant_id}`);
    if (brand_domain) console.log(`         domain=${brand_domain}`);
    if (connector_family) console.log(`         connector=${connector_family}`);

    if (!APPLY) { created++; continue; }

    // 1. Create tenant
    await pool.query(
      `INSERT IGNORE INTO \`tenants\` (tenant_id, tenant_type, display_name, status, metadata_json)
       VALUES (?, 'brand', ?, 'active', ?)`,
      [tenant_id, display_name, metadata]
    );

    // 2. Create connected system if connector family known
    if (connector_family || brand_domain) {
      await pool.query(
        `INSERT IGNORE INTO \`connected_systems\`
           (system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family, status, self_serve_capable)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)`,
        [system_id, tenant_id, target_key || brand_key,
         `${display_name} connector`,
         connector_family || "wordpress",
         brand_domain || null,
         connector_family || null]
      );
    }

    // 3. Create workspace
    await pool.query(
      `INSERT IGNORE INTO \`workspace_registry\`
         (workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, linked_brand_key)
       VALUES (?, ?, ?, ?, 'brand', 'ready', ?)`,
      [workspace_id, tenant_id, brand_key, `${display_name} Workspace`, brand_key]
    );

    // 4. Subscribe to starter plan
    await pool.query(
      `INSERT IGNORE INTO \`subscriptions\` (subscription_id, tenant_id, plan_id, status)
       VALUES (?, ?, ?, 'active')`,
      [sub_id, tenant_id, starter_plan_id]
    );

    created++;
  }

  await pool.end();

  console.log(`\n── Summary ──`);
  console.log(`  Brands found:   ${brands.length}`);
  console.log(`  Tenants created: ${created}${APPLY ? "" : " (dry-run — not written)"}`);
  console.log(`  Skipped:         ${skipped}`);
  if (!APPLY) console.log(`\nRe-run with --apply to write changes.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
