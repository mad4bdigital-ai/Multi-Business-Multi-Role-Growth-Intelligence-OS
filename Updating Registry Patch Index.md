# Updating Registry Patch Index

Last updated: 2026-05-04

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

- Status: in progress, uncommitted
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

- Status: implemented, uncommitted
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

- Status: implemented, uncommitted
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

- Status: implemented, uncommitted
- Files:
  - `http-generic-api/services/intentMaturationResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
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

## Verification Snapshot

- `node --check server.js`: pass
- `node test-ai-resolvers.mjs`: pass
- `node test-ai-resolver-routes.mjs`: pass
- `node test-provider-fetch-timeout.mjs`: pass
- `node test-routes.mjs`: pass with route runtime checks skipped by default
- `npm.cmd test`: pass
- `npm.cmd run validate`: pass, 173 passed / 0 failed

Note: `npm test` through PowerShell failed because `npm.ps1` is blocked by the local execution policy. `npm.cmd test` was used instead and passed.

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

## Current Uncommitted Work

- Modified:
  - `http-generic-api/package.json`
  - `http-generic-api/routes/index.js`
  - `http-generic-api/server.js`
- Untracked:
  - `Updating Registry Patch Index.md`
  - `http-generic-api/authService.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/services/`
  - `http-generic-api/stateManager.js`
  - `http-generic-api/test-ai-resolvers.mjs`

## Remaining Decisions

- Decide whether generated plans/tasks should remain synchronous API responses or also be persisted as JSON assets.
- Decide whether OpenAI should remain a direct `fetch` integration or be routed through the existing generic HTTP connector registry.
- Decide whether to add live route tests for `/ai/implementation-plan` and `/ai/task-manifest` beyond the current route registration and service tests.
