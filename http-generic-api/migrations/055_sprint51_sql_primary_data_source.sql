-- Sprint 51: SQL-primary data source — finalize Sheets as helper/mirror only.
--
-- Purely additive + descriptive. No table drops, no column changes, no row
-- deletes, no schema changes. Existing data is preserved.
--
-- Three changes (all idempotent — safe to re-run)
--   1. NEW tool governance_execution_log_sheets_recovery — explicit Sheets
--      mirror readback for admin recovery and parity verification.
--   2. NEW tool platform_data_source_census — returns row counts per SQL
--      table and Sheets mirror configuration, so admin GPT can audit
--      migration completeness without invoking raw SQL.
--   3. UPDATE existing tool governance_execution_log description and
--      display_name to reflect that the route now reads from SQL
--      execution_log (the runtime authority). http_path, http_method,
--      input_schema, tags, sort_order, fixed_body, and is_enabled are
--      intentionally untouched.
--
-- Important: the migrator splits files on the semicolon character before
-- stripping comments, so this header and every string literal below MUST
-- avoid semicolons. The same constraint was learned in migration 021.
--
-- Statement order: new tools first, then the UPDATE that references them.
-- If any INSERT fails the UPDATE never runs, so the live description never
-- references a tool that has not yet been created.

-- ─── 1. New tool: Sheets recovery readback for the execution log ──────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('governance_execution_log_sheets_recovery',
 'Execution Log Sheets Recovery',
 'Reads the latest execution log primary row from the Google Sheets mirror. Use this only for parity verification with the SQL source of truth or for break-glass recovery when SQL execution_log is unavailable. The runtime authority is the governance_execution_log tool (SQL).',
 'GET', '/governance/execution-log-sheets-recovery',
 NULL,
 NULL,
 NULL,
 'governance,recovery,sheets_mirror',
 75,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  tags         = VALUES(tags),
  is_enabled   = VALUES(is_enabled);

-- ─── 2. New tool: data-source census ──────────────────────────────────────────
INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('platform_data_source_census',
 'Platform Data Source Census',
 'Returns row counts and last-write timestamps for every SQL table in the platform registry (brands, actions, endpoints, plugins, execution_log, etc.) plus the Sheets mirror configuration. Use this to confirm SQL is the runtime authority, to find empty tables that may need seeding, or before any migration repair work.',
 'GET', '/admin/cli/data-source/census',
 NULL,
 NULL,
 NULL,
 'admin,data_source,audit',
 76,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  tags         = VALUES(tags),
  is_enabled   = VALUES(is_enabled);

-- ─── 3. Refresh the existing execution-log tool description ───────────────────
-- WHERE clause makes this a safe no-op if the row is somehow absent
-- (e.g. an older deploy where 050 has not yet seeded the registry).
UPDATE `admin_platform_endpoint_tools`
SET
  description = 'Returns the most recent rows from execution_log SQL table for audit and trace lookups. SQL is the runtime source of truth, and the Sheets mirror is async-only. Use governance_execution_log_sheets_recovery if you need to read from the Sheets mirror directly for parity verification or break-glass recovery.',
  display_name = 'Execution Log Latest (SQL)'
WHERE tool_key = 'governance_execution_log';
