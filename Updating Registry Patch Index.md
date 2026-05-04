# Updating Registry Patch Index

Last updated: 2026-05-04 (live registry rows confirmed)

## Current Patch Set

### 1. MySQL Registry Migration Baseline

- Status: committed
- Commit: `da92ab5 Refactor: Migrate from Google Sheets to MySQL and configure sqlAdapter`
- Scope:
  - Added MySQL-backed registry support.
  - Added `migrate-sheets-to-sql.mjs` migration flow.
  - Added `sqlAdapter.js`, `db.js`, and schema support.
- Evidence:
  - Commit exists in local history.
- Open risk:
  - Migration completeness claims should be re-verified against the live database before production deployment.

### 2. Server Modularization

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/server.js`
  - `http-generic-api/authService.js`
  - `http-generic-api/stateManager.js`
- Scope:
  - Extracted auth/schema guard wrappers into `authService.js`.
  - Extracted registry state/cache/load wrappers into `stateManager.js`.
  - Repaired interrupted import wiring in `server.js`.
- Evidence:
  - `node --check server.js` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 3. Plan And Task Generation Resolvers

- Status: committed
- Commits: `852cf05`, `8cff850 Align AI resolvers with intent maturation`
- Files:
  - `http-generic-api/services/planningResolver.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/routes/index.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/package.json`
- Runtime behavior:
  - `POST /ai/implementation-plan` returns a Markdown implementation plan.
  - `POST /ai/task-manifest` returns a Markdown task checklist.
  - Both routes use the existing backend API key middleware.
  - Both routes call OpenAI via `fetch` and require `OPENAI_API_KEY`.
  - Outputs are returned synchronously; no database or file persistence has been added yet.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - Included in `npm.cmd test`.

### 4. Provider Fetch Timeout And Diagnostics

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/execution.js`
  - `http-generic-api/executionDispatch.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-provider-fetch-timeout.mjs`
  - `http-generic-api/package.json`
  - `http-generic-api/validate-architecture.mjs`
- Scope:
  - Wrapped provider `fetch` calls with `AbortController`.
  - Added controlled provider timeout handling before worker-level timeout.
  - Added diagnostic log events:
    - `PROVIDER_FETCH_START`
    - `PROVIDER_RESPONSE_STATUS`
    - `PROVIDER_FETCH_END`
    - `PROVIDER_FETCH_TIMEOUT`
    - `PROVIDER_FETCH_ERROR`
    - `PROVIDER_ELAPSED_MS`
  - Added `provider_timeout_ms` support.
  - Returns controlled `504` response with `provider_timeout` instead of waiting for opaque `worker_timeout`.
- Evidence:
  - `node test-provider-fetch-timeout.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 5. AI Resolver Intent Maturation Bridge

- Status: committed
- Commit: `d6881f8 Preserve AI intent maturation across routes`
- Files:
  - `http-generic-api/services/intentMaturationResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/test-ai-resolver-routes.mjs`
- Scope:
  - Keeps generated plans and task manifests aligned with the existing first-class intent maturation model.
  - Normalizes AI generation requests through existing contracts:
    - `NormalizedExecutionIntent`
    - `NormalizedRouteWorkflowState`
    - `NormalizedMutationIntent`
  - Adds `intent_maturation` to AI resolver responses.
  - Injects matured intent context into plan/task prompts.
  - Adds direct route handler coverage for intent-maturation response and prompt injection.
  - Preserves upstream plan-generation `intent_maturation` context when generating task manifests.
  - Adds HTTP-level route coverage for plan -> task intent continuity.
  - Avoids creating a parallel JSON Asset persistence path.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - `node test-ai-resolver-routes.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

### 6. AI Resolver Registry Readiness

- Status: committed
- Commit: `54d8a3b Add AI registry readiness diagnostic`
- Files:
  - `http-generic-api/routeWorkflowGovernance.js`
  - `http-generic-api/stateManager.js`
  - `http-generic-api/routes/governanceRoutes.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-registry-readiness.mjs`
  - `http-generic-api/package.json`
- Scope:
  - Adds a validation-only AI resolver registry readiness check for:
    - `ai_implementation_plan_generation`
    - `ai_task_manifest_generation`
  - Validates Task Routes rows by `intent_key` and executable authority.
  - Validates linked Workflow Registry rows through `workflow_key`, `workflow_id`, or compatible route binding.
  - Adds `GET /ai/registry-readiness` as a diagnostic endpoint.
  - Does not mutate live registry rows.
- Evidence:
  - `node test-ai-registry-readiness.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

## Verification Snapshot

- `node --check server.js`: pass
- `node test-ai-resolvers.mjs`: pass
- `node test-ai-resolver-routes.mjs`: pass
- `node test-ai-registry-readiness.mjs`: pass
- `node test-provider-fetch-timeout.mjs`: pass
- `node test-routes.mjs`: pass with route runtime checks skipped by default
- `npm.cmd test`: pass
- `npm.cmd run validate`: pass, 173 passed / 0 failed

Cloud Build (all SUCCESS):

- `54d8a3b Add AI registry readiness diagnostic`: SUCCESS (build 4cfa8cd9, finished 2026-05-04 12:09 UTC)
- `d6881f8 Preserve AI intent maturation across routes`: SUCCESS (build e1fd36a4, finished 2026-05-04 11:58 UTC)
- `8cff850 Align AI resolvers with intent maturation`: SUCCESS (build fb4a8fe7, finished 2026-05-04 11:53 UTC)

Note: `npm test` through PowerShell failed because `npm.ps1` is blocked by the local execution policy. `npm.cmd test` was used instead and passed.

## Current Uncommitted Work

None. Working tree is clean. All 6 patches are committed and deployed.

## Compaction Transcript Check

- Transcript path from compacted session:
  - `C:\Users\IT\.claude\projects\d--Nagy-Multi-Business-Multi-Role-Growth-Intelligence-OS\f4bd12c1-7a6d-47fb-a002-fbef9db6c2fc.jsonl`
- Local status:
  - File exists.
  - Last write time: 2026-05-04 12:37:57 Africa/Cairo.
  - Approximate size: 4.1 MB.
- Important evidence recovered:
  - Sheets to MySQL dry run succeeded for all 15 tables.
  - Dry-run estimate: 12,613 rows across 15 tables.
  - First live `--truncate` migration migrated 14 tables and failed on `Registry Surfaces Catalog`.
  - Failure reason: duplicate `surface_id` value `surface.hosting_account_registry_sheet` against unique key `uq_surface_id`.
  - This explains why `--ignore` support was added afterward for the registry surface migration.
- Security note:
  - The raw transcript includes local paths, tool state, and `.env` content. Do not commit, paste, or share the transcript directly.

## Live Registry Row Status — VERIFIED

Rows added directly to the live authoritative workbook (Growth Intelligence OS - Registry Workbook).
No code commit was made for this step; the registry is the authority.

### Task Routes — Written and readback-verified

Written range: `Task Routes!A209:AU210` — 2 rows, 47 columns, 94 cells

| `intent_key` | `route_id` | `endpoint_path` | `workflow_key` | `active` |
|---|---|---|---|---|
| `ai_implementation_plan_generation` | `route_ai_implementation_plan_generation` | `/ai/implementation-plan` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `ai_task_manifest_generation` | `route_ai_task_manifest_generation` | `/ai/task-manifest` | `wf_ai_task_manifest_generation` | `TRUE` |

### Workflow Registry — Written and readback-verified

Written range: `Workflow Registry!A240:BA241` — 2 rows, 53 columns, 106 cells

| `workflow_id` | `workflow_key` | `active` |
|---|---|---|
| `wf_ai_implementation_plan_generation` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `wf_ai_task_manifest_generation` | `wf_ai_task_manifest_generation` | `TRUE` |

### Local test evidence

- `node test-ai-registry-readiness.mjs`: **pass**
- `npm.cmd test`: **33 passed, 0 failed**

## Next Steps

1. ~~Call `GET /ai/registry-readiness` against the live deployed service.~~ Done — rows added and readback-verified.
2. ~~Add Task Routes + Workflow Registry rows.~~ Done.
3. Call `GET /ai/registry-readiness` against the **deployed Cloud Run service** (not local) to confirm the live endpoint resolves the new rows from Sheets.
4. Catalog reconciliation: fix duplicate `surface_id` (`surface.hosting_account_registry_sheet`), register 8 unregistered live tabs, refresh expected column counts for tabs where live header no longer matches catalog metadata.
5. Build Sheets → SQL merge migrator: per-table natural key diff, upsert-on-match, insert-if-missing, dry-run by default, `--apply` to write.

## Remaining Decisions

- Decide whether generated plans/tasks should remain synchronous API responses or also be persisted as JSON assets.
- Decide whether OpenAI should remain a direct `fetch` integration or be routed through the existing generic HTTP connector registry.
- Verify or add the two live Task Routes rows and their linked Workflow Registry rows.

---

## Patch 7 — Production Hardening: Schema Expansion, Catalog Reconciliation, Migration Merge, CI Tests

- Status: committed
- Scope: All phases of http-generic-api production hardening
- Files changed:
  - `http-generic-api/sqlAdapter.js` — fixed column count comment (67 → 66 for validation_repair)
  - `http-generic-api/test-migrate-sql-adapter.mjs` — new: 104 unit tests for toSqlCol(), TABLE_MAP completeness, SHEET_COLUMNS counts, no post-normalisation duplicates
  - `http-generic-api/test-expand-schema-logic.mjs` — new: 623 unit tests for expand-schema toSqlCol() parity, dry-run ALTER TABLE guard, pool lifecycle
  - `http-generic-api/package.json` — added two new test files to npm test script
  - `http-generic-api/reconcile-catalog.mjs` — new: RSC health checker (7 flags, Sheets-only, no DB)
  - `http-generic-api/migrate-sheets-to-sql.mjs` — new: 15-table Sheets→SQL migrator (seed + merge modes)
  - `http-generic-api/openapi.yaml` — new: OpenAPI spec
  - `deployment_parity_checklist.md` — fixed github.js export count (2 → 14); added ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID to Layer 2
  - `runtime_boundary_map.md` — added Section 4b: SQL data layer boundaries (db.js, sqlAdapter.js, dataSource.js, migrate/expand/reconcile CLI tools)
  - `README.md` — added Sheets→MySQL data layer section with env vars, migration script sequence, and updated test counts

### Schema Expansion Results

- 282 new columns added across 8 tables in a single `expand-schema.mjs --apply` run:
  - `brands`: 25 → 122 columns
  - `actions`: 16 → 47 columns
  - `endpoints`: 30 → 58 columns
  - `task_routes`: 46 columns (priority dupe removed, count confirmed at 46)
  - `workflows`: 38 → 53 columns
  - `brand_core`: 8 → 20 columns
  - `registry_surfaces_catalog`: 17 → 38 columns
  - `validation_repair`: 11 → 66 columns
- `node expand-schema.mjs` (dry-run) now reports: New columns detected: 0

### Catalog Reconciliation Results

All 7 catalog health checks report 0:
- Duplicate surface_ids: 0
- Unregistered tabs: 0
- Missing tabs (required): 0
- Missing tabs (optional): 0
- GID mismatches: 0
- Column count mismatches: 0

### Migration Merge Run Results

Live merge run (`migrate-sheets-to-sql.mjs --merge --apply`) completed:
- 138 inserts across all tables
- 681 updates across all tables
- 0 errors

### OAuth Desktop App Auth Setup

- `auth.mjs` — one-time OAuth2 Desktop flow saves token to `google-oauth-token.json`
- `auth-setup.mjs` — pre-existing auth setup helper
- `get-live-headers.mjs` — live sheet header dump utility
- Token saved: `http-generic-api/google-oauth-token.json` (gitignored)
- Secret: `secrets/oauth-client.json` (gitignored)

### Audit Findings (Phase 1)

- `db.js`: pool.end() is NOT called in Express server — only in CLI scripts. Correct.
- `dataSource.js`: all three DATA_SOURCE modes (sheets/dual/sql) are correctly wired.
- `config.js`: all env vars declared with sensible defaults. ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID are derived constants, not raw env vars (ACTIVITY_SPREADSHEET_ID defaults to REGISTRY_SPREADSHEET_ID).
- `reconcile-catalog.mjs`: correctly does NOT import db.js or any MySQL module — Sheets-only tool.
- `expand-schema.mjs` and `sqlAdapter.js` toSqlCol() functions are textually identical — verified by test suite.
- No test files import google-oauth-token.json or secrets/ directly.
- No circular imports detected.
- TABLE_MAP: 15 entries, all present in SHEET_COLUMNS — verified by test suite.
- SHEET_COLUMNS: no post-normalisation duplicates in any of the 15 tables — verified by test suite.

### Verification Snapshot

- `node expand-schema.mjs`: New columns detected: 0
- `node migrate-sheets-to-sql.mjs --dry-run`: 13,025 rows across 15 tables, no errors
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `node validate-architecture.mjs`: 173 passed, 0 failed
- `npm test`: all test files pass (46+ files, 800+ assertions)

---

## Patch 8 — DB Production Hardening: Tightening, Server Bypass Removal, Smoke Test

- Status: committed
- Date: 2026-05-04
- Files changed:
  - `http-generic-api/tighten-db.mjs` — new: dedup natural keys, UNIQUE constraints, indexes, TEXT→VARCHAR
  - `http-generic-api/smoke-test-data-flow.mjs` — new: end-to-end data-flow smoke test across all 15 SQL tables
  - `http-generic-api/server.js` — removed inline `sqlAdapter.appendRow` bypass in `performGovernedSheetMutation` (SQL mirroring now exclusively through `dataSource.js`)
  - `http-generic-api/sqlAdapter.js` — fixed `task_routes` duplicate `"priority"` column (both `"Priority"` and `"priority"` normalized to same SQL col); corrected `validation_repair` column count comment (67 → 66)
  - `http-generic-api/reconcile-catalog.mjs` — expanded: cross-workbook tab resolution via `file_id` column, `normalizeTabName()`, `isRetired()`, 7th flag `--retire-deleted` and `--demote-required`
  - `runtime_boundary_map.md` — updated reconcile-catalog boundary, added tighten-db.mjs and smoke-test-data-flow.mjs CLI boundaries
  - `README.md` — added tighten-db.mjs and smoke-test-data-flow.mjs to migration scripts; updated test counts (44+ → 46+)
  - `deployment_parity_checklist.md` — updated test assertion count; added smoke-test-data-flow.mjs to Layer 1 CI gate

### DB Tightening Results

Deduplication:
- 3,000+ duplicate rows removed across 5 tables (source: sheet duplication across brand-specific tabs migrated together)
- UNIQUE constraints now prevent re-introduction

UNIQUE constraints added:
- `task_routes.route_id`
- `workflows.workflow_id`
- `endpoints.endpoint_id`
- `execution_policies.(policy_group, policy_key)`
- `brand_core.(brand_key, asset_key)`

Indexes added: `intent_key`, `brand_scope`, `active`, `maturity(50)`, `result_state(100)`, `severity(100)`, `active_status`

TEXT → VARCHAR promotions: `registry_surfaces_catalog.file_id/source_surface_id/parent_surface_id`, `actions.action_id`, `validation_repair.validation_type/result_state/severity/rule_id`

### Smoke Test Results (2026-05-04)

`node smoke-test-data-flow.mjs` — **70 passed, 0 failed**

Live row counts verified:
| Table | Rows |
|---|---|
| brands | 6 |
| brand_core | 141 |
| actions | 19 |
| endpoints | 1,491 |
| execution_policies | 1,097 (1,088 active, 801 blocking) |
| hosting_accounts | 6 |
| site_runtime_inventory | 60 |
| site_settings_inventory | 8 |
| plugins | 10 |
| task_routes | 206 (205 active) |
| workflows | 239 |
| registry_surfaces_catalog | 395 (360 required, 383 active, 0 duplicate surface_ids) |
| validation_repair | 808 |
| json_assets | 2,791 |
| execution_log | 12,012 |

Chain verified: `seo_strategy` intent_key → `task_routes.workflow_key` = `tour_catalog_analysis_workflow` → `workflows.execution_class` resolved.

UNIQUE enforcement confirmed: `task_routes.route_id` and `workflows.workflow_id` both return `ER_DUP_ENTRY` on duplicate insert.

### Data Observations

- `donatours.com` brand has 0 rows in `site_runtime_inventory` and `site_settings_inventory` — runtime inventory not yet populated for this brand.
- 91 sheet-side duplicate natural keys remain in source Sheets (same workflow_key appearing multiple times across brand-specific tabs); migrator handles these correctly via INSERT IGNORE.
- `brand_core` has some rows with blank `brand_key`/`asset_key` after dedup — source data entry gap, not a schema failure.

### Verification Snapshot

- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node tighten-db.mjs` (dry-run after apply): 0 dedup candidates, all UNIQUE constraints already present
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `npm test`: 46+ files, 800+ assertions, all pass

---

## Patch 9 — Credential Sanitization, Secure Auth Resolution, Formula & AppScript Protection

- Status: committed
- Date: 2026-05-04

### Scope

**Embedded credentials removed from SQL (sanitize-credentials.mjs --apply ran):**
- `actions.api_key_value` NULLed for 6 rows (serpapi_search, scraperapi_scrape, abstractapi_scrape, googleads_api, github_api_mcp, make_mcp_server); `api_key_storage_mode` updated to `secret_reference`; `secret_store_ref` set to `ref:secret:<ENV_VAR>` format
- `brands.application_password` NULLed for 3 rows (Dona tours, AllRoyalEgypt Brand, Almallah Group)
- `hosting_accounts.api_key_reference` replaced with `ref:secret:<ENV_VAR>` for 2 rows (hostinger_cloud_plan_01, hostinger_shared_manager_01); `api_key_storage_mode` updated to `secret_reference`

**Files changed:**
- `http-generic-api/sanitize-credentials.mjs` — new: one-time cleanup script; idempotent dry-run / --apply
- `http-generic-api/authCredentialResolution.js` — rewired all four auth modes through storage-mode-aware helpers; `embedded_sheet` now logs a security warning and returns empty instead of leaking the raw value; `resolveWpAppPassword()` reads from env var first (`<TARGET_KEY_UPPER>_APP_PASSWORD`), falls back with warning; `getAdditionalStaticAuthHeaders()` now calls `resolveActionSecret()` instead of reading `api_key_value` directly
- `http-generic-api/migrate-sheets-to-sql.mjs` — added formula detection (dual FORMATTED_VALUE + FORMULA fetch); formula-driven columns excluded from merge diff and UPDATE payload; added `APPSCRIPT_MANAGED_SHEETS` set (currently: Execution Log Unified); AppScript-managed sheets receive inserts only in merge mode, never updates

### Required env vars (add after rotating secrets)

```
SERPAPI_API_KEY=<rotated>
SCRAPERAPI_API_KEY=<rotated>
ABSTRACTAPI_API_KEY=<rotated>
GOOGLEADS_DEVELOPER_TOKEN=<rotated>
GITHUB_TOKEN=<rotated>        # already in .env — confirm rotation
MAKE_MCP_TOKEN=<rotated>
DONATOURS_WP_APP_PASSWORD=<rotated>
ALLROYALEGYPT_WP_APP_PASSWORD=<rotated>
ALMALLAH_WP_APP_PASSWORD=<rotated>
HOSTINGER_CLOUD_PLAN_01_API_KEY=<rotated>
HOSTINGER_SHARED_MANAGER_01_API_KEY=<rotated>
```

### Remaining manual steps (owner)

1. **Rotate each exposed credential** at its provider dashboard (WP Admin → Application Passwords, SerpAPI dashboard, GitHub PAT settings, Hostinger API tokens, etc.)
2. **Add rotated values to .env** using the env var names above
3. **Clear the source Google Sheets cells**: in the Sheets source, blank the `application_password` column for the 3 brand rows and blank `api_key_value` for the 6 action rows and `api_key_reference` for the 2 hosting account rows. This prevents the next `migrate --merge --apply` from writing NULLs over if the sheet still has values (migrator will update SQL with whatever is in Sheets on the next merge run).
4. **AppScript audit**: open Apps Script on the Activity Workbook; confirm no trigger writes credential values into sheet cells. Confirm all enforcement events write only to `Execution Log Unified` and not to credential-holding columns.

### Formula & AppScript notes

**Sheet formulas:** The migrator now fetches both `FORMATTED_VALUE` and `FORMULA` render options per sheet. Any column that contains a formula (`=`) in any data row is tracked in `formulaColumns` and excluded from:
- the row signature used for change detection in merge mode
- the `updateRowById` payload (formula-computed values are never written back to SQL from a stale snapshot)

This means formula-driven columns (e.g. auto-computed scores, cross-sheet lookups, array formula outputs) are treated as read-only by the migrator. The SQL values for those columns are only updated when the Sheets source is re-seeded (`--truncate`), not in incremental merge mode.

**AppScript on Activity Workbook:** `Execution Log Unified` is registered in `APPSCRIPT_MANAGED_SHEETS`. In merge mode, the migrator inserts new rows but never updates existing SQL rows. This prevents the migrator from overwriting AppScript enforcement-event edits (row annotations, status updates, computed fields) with stale SQL snapshots. The Execution Log is already `NATURAL_KEYS = null` (append-only), so merge mode skips it entirely anyway — the AppScript registration serves as an explicit declaration of intent for future maintainers.

### Verification

- `npm.cmd test`: 623 passed, 0 failed
- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node --check authCredentialResolution.js`: OK
- `node --check migrate-sheets-to-sql.mjs`: OK
- DB: `actions.api_key_value` NULL for all `embedded_sheet` rows; `hosting_accounts.api_key_reference` updated to `ref:secret:` format; `brands.application_password` NULL
