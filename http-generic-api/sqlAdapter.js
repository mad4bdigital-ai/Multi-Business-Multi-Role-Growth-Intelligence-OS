import { getPool } from "./db.js";

// ── Sheet name → SQL table name ────────────────────────────────────────────────
const TABLE_MAP = {
  "Brand Registry":                     "brands",
  "Brand Core Registry":                "brand_core",
  "Actions Registry":                   "actions",
  "API Actions Endpoint Registry":      "endpoints",
  "Execution Policy Registry":          "execution_policies",
  "Hosting Account Registry":           "hosting_accounts",
  "Site Runtime Inventory Registry":    "site_runtime_inventory",
  "Site Settings Inventory Registry":   "site_settings_inventory",
  "Plugin Inventory Registry":          "plugins",
  "Task Routes":                        "task_routes",
  "Workflow Registry":                  "workflows",
  "Registry Surfaces Catalog":          "registry_surfaces_catalog",
  "Validation & Repair Registry":       "validation_repair",
  "JSON Asset Registry":                "json_assets",
  "Execution Log Unified":              "execution_log",
};

// ── Canonical sheet column names per table ─────────────────────────────────────
// Defines both the write order and the reverse-mapping key for reads.
// Columns already in snake_case map 1:1; spaced/special names are normalised.
const SHEET_COLUMNS = {
  brands: [
    "Brand Name", "Normalized Brand Name", "brand_domain", "target_key",
    "site_aliases_json", "base_url", "transport_action_key", "auth_type",
    "credential_resolution", "username", "application_password",
    "default_headers_json", "write_allowed", "destructive_allowed",
    "transport_enabled", "target_resolution_mode", "hosting_provider",
    "hosting_account_key", "hostinger_api_target_key", "server_environment_label",
    "server_environment_type", "server_region_or_datacenter",
    "server_primary_domain", "server_panel_reference",
    "hosting_account_registry_ref",
  ],
  brand_core: [
    "brand_key", "asset_key", "doc_key", "doc_id", "file_id",
    "google_doc_id", "brand_core_docs_json", "status",
  ],
  actions: [
    "action_key", "status", "module_binding", "connector_family",
    "api_key_mode", "api_key_param_name", "api_key_header_name",
    "api_key_value", "api_key_storage_mode", "openai_schema_file_id",
    "oauth_config_file_id", "oauth_config_file_name",
    "runtime_capability_class", "runtime_callable", "primary_executor", "notes",
  ],
  endpoints: [
    "endpoint_id", "parent_action_key", "endpoint_key", "endpoint_operation",
    "provider_domain", "method", "endpoint_path_or_function", "route_target",
    "openai_action_name", "module_binding", "connector_family", "status",
    "spec_validation_status", "auth_validation_status",
    "privacy_validation_status", "execution_readiness", "endpoint_role",
    "execution_mode", "transport_required", "fallback_allowed",
    "fallback_match_basis", "fallback_provider_domain",
    "fallback_connector_family", "fallback_action_name", "fallback_route_target",
    "fallback_notes", "inventory_role", "inventory_source", "notes",
    "brand_resolution_source", "transport_action_key",
  ],
  execution_policies: [
    "policy_group", "policy_key", "policy_value", "active",
    "execution_scope", "affects_layer", "blocking", "notes",
  ],
  hosting_accounts: [
    "hosting_account_key", "hosting_provider", "account_identifier",
    "api_auth_mode", "api_key_reference", "api_key_storage_mode",
    "plan_label", "plan_type", "account_scope_notes", "status",
    "last_reviewed_at", "brand_sites_json", "resolver_target_keys_json",
    "auth_validation_status", "endpoint_binding_status",
    "resolver_execution_ready", "last_runtime_check_at", "ssh_available",
    "wp_cli_available", "shared_access_enabled", "account_mode",
    "ssh_host", "ssh_port", "ssh_username", "ssh_auth_mode",
    "ssh_credential_reference", "ssh_runtime_notes",
  ],
  site_runtime_inventory: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "supported_cpts", "supported_taxonomies", "generated_endpoint_support",
    "runtime_validation_status", "last_runtime_validated_at", "active_status",
  ],
  site_settings_inventory: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "permalink_structure", "timezone_string", "site_language", "active_theme",
    "settings_validation_status", "last_settings_validated_at", "active_status",
  ],
  plugins: [
    "target_key", "brand_name", "brand_domain", "base_url", "site_type",
    "active_plugins", "plugin_versions_json", "plugin_owned_tables",
    "plugin_owned_entities", "plugin_validation_status",
    "last_plugin_validated_at", "active_status",
  ],
  task_routes: [
    "Task Key", "Trigger Terms", "Route Modules", "Execution Layer",
    "Priority", "Enabled", "Output Focus", "Notes", "Entry Sources",
    "Linked Starter Titles", "Active Starter Count", "Route Key Match Status",
    "row_id", "route_id", "active", "intent_key", "brand_scope",
    "request_type", "route_mode", "target_module", "workflow_key",
    "lifecycle_mode", "memory_required", "logging_required", "review_required",
    "allowed_states", "degraded_action", "blocked_action", "match_rule",
    "route_source", "last_validated_at",
  ],
  workflows: [
    "Workflow ID", "Workflow Name", "Module Mode", "Trigger Source",
    "Input Type", "Primary Objective", "Mapped Engine(s)", "Engine Order",
    "Workflow Type", "Primary Output", "Input Detection Rules",
    "Output Template", "Priority", "Route Key", "Execution Mode",
    "User Facing", "Parent Layer", "Status", "Linked Workflows",
    "Linked Engines", "Notes", "Entry Priority Weight", "Dependency Type",
    "Output Artifact Type", "workflow_key", "active", "target_module",
    "execution_class", "lifecycle_mode", "route_compatibility",
    "memory_required", "logging_required", "review_required", "allowed_states",
    "degraded_action", "blocked_action", "registry_source", "last_validated_at",
  ],
  registry_surfaces_catalog: [
    "surface_id", "surface_name", "worksheet_name", "worksheet_gid",
    "active_status", "authority_status", "required_for_execution",
    "schema_ref", "schema_version", "header_signature", "expected_column_count",
    "binding_mode", "sheet_role", "audit_mode",
    "legacy_surface_containment_required", "repair_candidate_types",
    "repair_priority",
  ],
  validation_repair: [
    "validation_id", "entity_key", "surface_id", "validation_target",
    "target_surface_id", "validation_status", "readiness_state",
    "repair_required", "status", "last_validated_at", "notes",
  ],
  json_assets: [
    "asset_id", "brand_name", "asset_key", "asset_type", "cpt_slug",
    "mapping_status", "mapping_version", "storage_format", "google_drive_link",
    "source_mode", "source_asset_ref", "json_payload", "transport_status",
    "validation_status", "last_validated_at", "notes", "active_status",
  ],
  execution_log: [
    "Run Date", "Start Time", "End Time", "Duration Seconds", "Entry Type",
    "Execution Class", "Source Layer", "User Input", "Matched Aliases",
    "Route Key(s)", "Selected Workflows", "Engine Chain", "Execution Mode",
    "Decision Trigger", "Score Before", "Score After", "Performance Delta",
    "Execution Status", "Output Summary", "Recovery Status", "Recovery Score",
    "Recovery Notes", "route_id", "route_status", "route_source",
    "matched_row_id", "intake_validation_status", "execution_ready_status",
    "failure_reason", "recovery_action", "artifact_json_asset_id",
    "target_module_writeback", "target_workflow_writeback",
    "execution_trace_id_writeback", "log_source_writeback",
    "monitored_row_writeback", "performance_impact_row_writeback",
    "used_logic_id", "used_logic_name", "resolved_logic_doc_id",
    "resolved_logic_mode", "logic_pointer_resolution_status",
    "logic_knowledge_status", "logic_rollback_status",
    "logic_association_status", "used_engine_names",
    "used_engine_registry_refs", "used_engine_file_ids",
    "engine_resolution_status", "engine_association_status",
    "retired_shadow_target_module", "retired_shadow_target_workflow",
    "retired_shadow_execution_trace_id", "retired_shadow_log_source",
    "retired_shadow_monitored_row", "retired_shadow_performance_impact_row",
  ],
};

// ── Column name normalisation ──────────────────────────────────────────────────
// "Route Key(s)" → "route_keys"  |  "Brand Name" → "brand_name"
function toSqlCol(name) {
  return name
    .toLowerCase()
    .replace(/\(s\)/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ── Reverse maps: sql_col → original sheet col name, built once at load ────────
const REVERSE_MAP = {};
for (const [table, cols] of Object.entries(SHEET_COLUMNS)) {
  REVERSE_MAP[table] = {};
  for (const col of cols) {
    REVERSE_MAP[table][toSqlCol(col)] = col;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveTable(sheetName) {
  const table = TABLE_MAP[sheetName];
  if (!table) throw new Error(`sqlAdapter: unknown sheet "${sheetName}"`);
  return table;
}

function sqlRowToSheetRow(table, sqlRow) {
  const map = REVERSE_MAP[table] || {};
  const result = {};
  for (const [col, val] of Object.entries(sqlRow)) {
    const sheetCol = map[col] || col;
    result[sheetCol] = val == null ? "" : String(val);
  }
  return result;
}

function sheetRowToSqlPairs(table, rowObject) {
  const cols = SHEET_COLUMNS[table] || [];
  const sqlCols = [];
  const vals = [];
  for (const col of cols) {
    const sqlCol = toSqlCol(col);
    // Accept the value keyed by either the sheet name or the sql name
    const val = col in rowObject ? rowObject[col]
              : sqlCol in rowObject ? rowObject[sqlCol]
              : undefined;
    if (val !== undefined) {
      sqlCols.push(sqlCol);
      vals.push(val === "" ? null : val);
    }
  }
  return { sqlCols, vals };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function readTable(sheetName) {
  const table = resolveTable(sheetName);
  const [rows] = await getPool().query(
    `SELECT * FROM \`${table}\` ORDER BY id`
  );
  return rows.map(({ id, created_at, updated_at, ...rest }) =>
    sqlRowToSheetRow(table, rest)
  );
}

export async function appendRow(sheetName, rowObject) {
  const table = resolveTable(sheetName);
  const { sqlCols, vals } = sheetRowToSqlPairs(table, rowObject);
  if (!sqlCols.length) return null;
  const placeholders = sqlCols.map(() => "?").join(", ");
  const colList = sqlCols.map((c) => `\`${c}\``).join(", ");
  const [result] = await getPool().query(
    `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`,
    vals
  );
  return result.insertId;
}

export async function updateRow(sheetName, rowObject, id) {
  const table = resolveTable(sheetName);
  const { sqlCols, vals } = sheetRowToSqlPairs(table, rowObject);
  if (!sqlCols.length) return;
  const setClause = sqlCols.map((c) => `\`${c}\` = ?`).join(", ");
  await getPool().query(
    `UPDATE \`${table}\` SET ${setClause} WHERE id = ?`,
    [...vals, id]
  );
}

export async function deleteRow(sheetName, id) {
  const table = resolveTable(sheetName);
  await getPool().query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
}

export async function findRows(sheetName, whereColSheet, value) {
  const table = resolveTable(sheetName);
  const col = toSqlCol(whereColSheet);
  const [rows] = await getPool().query(
    `SELECT * FROM \`${table}\` WHERE \`${col}\` = ? ORDER BY id`,
    [value]
  );
  return rows.map(({ id, created_at, updated_at, ...rest }) =>
    sqlRowToSheetRow(table, rest)
  );
}

// Bulk insert — used by the migrator script. Processes in chunks of 100 rows.
export async function bulkInsertRows(sheetName, rows, { ignore = false } = {}) {
  if (!rows.length) return 0;
  const table = resolveTable(sheetName);
  const sheetCols = SHEET_COLUMNS[table] || [];
  if (!sheetCols.length) return 0;

  const sqlCols = sheetCols.map(toSqlCol);
  const colList = sqlCols.map((c) => `\`${c}\``).join(", ");
  const rowPlaceholder = `(${sqlCols.map(() => "?").join(", ")})`;
  const keyword = ignore ? "INSERT IGNORE INTO" : "INSERT INTO";
  const CHUNK = 100;
  let total = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => rowPlaceholder).join(", ");
    const vals = chunk.flatMap((row) =>
      sheetCols.map((col) => {
        const v = col in row ? row[col] : (toSqlCol(col) in row ? row[toSqlCol(col)] : null);
        return v === "" ? null : (v ?? null);
      })
    );
    const [result] = await getPool().query(
      `${keyword} \`${table}\` (${colList}) VALUES ${placeholders}`,
      vals
    );
    total += result.affectedRows;
  }
  return total;
}

export async function clearTable(sheetName) {
  const table = resolveTable(sheetName);
  await getPool().query(`TRUNCATE TABLE \`${table}\``);
}

export { TABLE_MAP, SHEET_COLUMNS };
