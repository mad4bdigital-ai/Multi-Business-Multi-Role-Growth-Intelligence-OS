# Multi-Business Multi-Role Growth Intelligence OS

This repository is a governed, registry-driven execution system. It is not primarily a generic web application stack, even though it contains application runtime code.

The architecture is centered on canonical authority documents, registry-backed execution control, validation-first runtime behavior, and governed logging/writeback.

## Canonical authority order

When understanding or changing this repository, use the following authority order:

1. `system_bootstrap.md`
2. `memory_schema.json`
3. `direct_instructions_registry_patch.md`
4. `module_loader.md`
5. `prompt_router.md`

Supporting but secondary:
- runtime implementation files
- `http-generic-api/*`
- this `README.md`

If this README conflicts with canonicals, the canonicals win.

## Core execution model

The intended execution chain is:

1. `prompt_router`
2. `module_loader`
3. `system_bootstrap`
4. runtime tool or connector execution
5. governed logging and writeback
6. durable memory persistence through `memory_schema.json`

Execution is expected to be:
- governed
- registry-centered
- validation-first
- evidence-preserving

Execution without validation evidence is not considered complete.

## Architecture overview

### Canonical governance layer

The root canonical files define:
- routing expectations
- loading and readiness expectations
- activation and bootstrap rules
- hard enforcement constraints
- durable memory structure

These documents are the real architecture spine of the project.

### Memory schema layer

`memory_schema.json` is the persistent state contract root. It has been decomposed into 12 domain sub-schemas under `schemas/`, each referenced via JSON Schema `$ref`:

| Sub-schema | Domain |
|---|---|
| `shared` | Primitive types shared across domains |
| `business_identity` | Company, catalog, destinations, modules |
| `brand` | Brand context, identity, writing engine |
| `execution` | Runtime validation, activation, Google Workspace |
| `analytics` | Measurement, revenue signals, tracking bindings |
| `governance` | Schema state, drift detection, variable contracts |
| `logic_knowledge` | Logic pointers, logic knowledge, business-type knowledge |
| `repair_audit` | Repair memory, audit state, anomaly clusters |
| `routing_transport` | Routing context, HTTP transport, surface roles |
| `graph_addition` | Graph intelligence, governed addition pipeline |
| `operations` | System context, monitoring, writeback rules |
| `wordpress_api` | WordPress state, API inventory, credential resolution |

The root schema enforces `additionalProperties: false` and all 99 required fields. The root is now about 41 KB after moving large domain blocks into `schemas/`. Validate schema references with `node validate-memory-schema.mjs`.

### Registry-centered authority layer

Important governed surfaces include:
- `Task Routes`
- `Workflow Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Execution Log Unified`
- `JSON Asset Registry`
- `Brand Registry`
- `Hosting Account Registry`
- `Brand Core Registry`

These governed surfaces are now SQL-primary. The Google Sheets workbooks remain the human-readable mirror, but MySQL is the authoritative read source for runtime execution.

Runtime behavior should prefer live registry truth over local assumptions, stale memory, or narrative summaries.

### Runtime implementation layer

The main runtime subtree currently visible is [`http-generic-api`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api>).

That subtree currently contains:
- the main route/orchestration runtime in `server.js`
- connector support modules
- governed registry and writeback helpers
- async job orchestration
- `resolveLogicPointerContext.js` — canonical logic pointer resolution and governed legacy rollback guard
- a modularized WordPress migration subsystem
- a MySQL-backed data layer with Google Sheets as the human-readable mirror

### Sheets to MySQL data layer

The `http-generic-api/` subtree includes a production MySQL-backed data layer alongside Google Sheets. The runtime remains Sheets-first by default (`DATA_SOURCE=sheets`); switch to `dual` or `sql` to route reads through MySQL.

**Environment variables required:**
| Variable | Purpose | Default |
|---|---|---|
| `DB_HOST` | MySQL host | (required) |
| `DB_PORT` | MySQL port | `3306` |
| `DB_NAME` | MySQL database name | (required) |
| `DB_USER` | MySQL username | (required) |
| `DB_PASSWORD` | MySQL password | (required) |
| `DATA_SOURCE` | Routing mode: `sheets` / `dual` / `sql` | `sheets` |
| `REGISTRY_SPREADSHEET_ID` | Primary Google Sheets workbook ID | (required for CLI scripts) |
| `ACTIVITY_SPREADSHEET_ID` | Activity log workbook ID | defaults to `REGISTRY_SPREADSHEET_ID` |

**Migration scripts (run from `http-generic-api/`):**

```powershell
# 1. Verify schema is up to date (dry-run — no writes)
node expand-schema.mjs

# 2. Apply any missing columns
node expand-schema.mjs --apply

# 3. Dry-run migration: shows row counts per table, no SQL writes
node migrate-sheets-to-sql.mjs --dry-run

# 4. Merge mode dry-run: shows per-table insert/update/unchanged diff
node migrate-sheets-to-sql.mjs --merge

# 5. Merge mode apply: write inserts and updates
node migrate-sheets-to-sql.mjs --merge --apply

# 6. Tighten the DB: dedup natural keys, add UNIQUE constraints + indexes, TEXT->VARCHAR (dry-run)
node tighten-db.mjs

# 7. Apply DB tightening
node tighten-db.mjs --apply

# 8. Smoke test data flow
node smoke-test-data-flow.mjs
```

Migration sequence for a fresh database: run `expand-schema.mjs --apply` first, then `migrate-sheets-to-sql.mjs --merge --apply`, then `tighten-db.mjs --apply`. For subsequent incremental syncs use `--merge --apply`; the migrator skips unchanged rows. For the execution log (append-only, no natural key) use seed mode without `--merge`. Run `smoke-test-data-flow.mjs` after any DB change to verify table integrity.

Migration to SQL is complete. The platform runs SQL-primary for registry lookups.

### Connector and subsystem layer

`http-generic-api` is the clearest connector-style boundary in the repo today. It demonstrates:
- policy-enforced transport execution
- explicit connector-oriented boundaries
- registry-backed execution decisions
- governed logging and sink handling

Its WordPress subsystem is split into:
- shared helpers
- a top-level orchestrator in `wordpress/phaseA.js`
- phase modules `B` through `P` for governed migration domains

## Current repository status

The project has completed Sprint 2 (WordPress modular extraction), Sprint 3 (http-generic-api decomposition), and Sprint 4 (memory schema decomposition). The runtime and schema layer are both materially modular.

Current state:
- `http-generic-api/server.js` is decomposed - reduced from ~29,000 lines to ~4,636 lines; authority-based modules extracted
- `http-generic-api/wordpress/` - 16 phase modules (A-P), shared.js, index.js barrel (545 exports)
- `http-generic-api/normalization.js` - canonical normalization layer successfully implementing all A-H domains (Execution Intent, Policy State, Endpoint Identity, Route/Workflow State, Surface Classification, Mutation Intent, Execution Result, Sink Write Contract)
- `memory_schema.json` decomposed into 12 domain sub-schemas in `schemas/` (about 41 KB root; schema refs validated by `validate-memory-schema.mjs`)
- `http-generic-api/mutationGovernance.js`, `governedChangeControl.js`, `governedSheetWrites.js` - centralized mutation and writeback governance
- `http-generic-api/registryResolution.js`, `routeWorkflowGovernance.js`, `registryMutations.js` - registry-backed routing and execution control
- `http-generic-api/executionRouting.js` - isolated HTTP execution context resolution with dependency-injected guard chain
- `http-generic-api/auth.js` - Google OAuth scope resolution, policy enforcement, and resilience helpers; fully wired
- `http-generic-api/driveFileLoader.js` - schema and OAuth config loader with `supportsAllDrives: true` for shared-drive artifact reads
- governed sink handling for `Execution Log Unified` and `JSON Asset Registry` is stable
- 46+ test files passing with 800+ assertions: utility, job runner, execution routing, connectors, routes, activation bootstrap cache, Google Sheets chunking, sheets range drift, starter authority surfaces, transport governance, activation classification, activation response, governed activation runner, registry alignment validator, logic switching smoke, WordPress, AI resolvers, SQL migration tooling (sqlAdapter TABLE_MAP completeness, column normalisation, duplicate detection, expand-schema dry-run guard), and data-flow smoke test (all 15 SQL tables, route→workflow chain, UNIQUE constraint enforcement)
- `/health` reports degraded dependency truth for Redis/BullMQ instead of assuming queue connectivity
- async job submission returns `503` when the queue backend cannot accept work (safely rejects to prevent job loss)
- runtime instances can run in API-only mode with `QUEUE_WORKER_ENABLED=FALSE`, or connect to Memorystore/Upstash/Hostinger Redis for background workers
- `All 19 actions are runtime_callable with correct auth modes: api_key_query, bearer_token, google_oauth2, google_ads_oauth2, per_target_credentials, mcp_connector`
- `googleAuthTokenResolver.js — shared Google OAuth2 token cache; pre-warmed at server start; supports service account file, inline SA JSON, or GOOGLE_REFRESH_TOKEN user OAuth fallback`
- `connectorExecutor.js — MCP connector branch added: plans with connected_system.connector_family=make_mcp dispatch to dispatchMcpConnector() via JSON-RPC 2.0 to Make MCP stateless endpoint`

## Upgrade direction

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

Ongoing priorities:
- maintain canonical/runtime alignment on every change
- keep test coverage and architecture checks green
- treat deployment parity as a required verification step, not optional

## Documentation map

Primary documents:
- [`system_bootstrap.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/system_bootstrap.md>)
- [`memory_schema.json`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/memory_schema.json>) - root schema; domain sub-schemas in [`schemas/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/schemas/>)
- [`direct_instructions_registry_patch.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/direct_instructions_registry_patch.md>)
- [`module_loader.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/module_loader.md>)
- [`prompt_router.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/prompt_router.md>)

Operations and validation:
- [`canonical_validation_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonical_validation_checklist.md>)
- [`runtime_boundary_map.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_boundary_map.md>)
- [`governed_mutation_playbook.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/governed_mutation_playbook.md>)
- [`connector_contracts.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/connector_contracts.md>)
- [`deployment_parity_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/deployment_parity_checklist.md>)
- [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)

Agent-facing guide:
- [`AI_Agent_Knowledge_Guide.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/AI_Agent_Knowledge_Guide.md>)

## Canonical editing workflow

The four root canonical markdown files are lightweight generated indexes with a `Domain Index` at the top. Edit the source files under [`canonicals/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonicals/>) and rebuild the roots:

```powershell
node build-canonicals.mjs
```

To verify generated roots are current without rewriting them:

```powershell
node build-canonicals.mjs --check
```

To validate the canonical source structure itself:

```powershell
node validate-canonical-sources.mjs
```

To find the right canonical source file by domain keyword:

```powershell
node find-canonical-domain.mjs repair
node find-canonical-domain.mjs prompt_router repair
```

Do not edit generated root canonical files directly. The authoritative canonical body lives in the matching source files under `canonicals/`.

## Working rules for contributors and agents

- Read canonicals before proposing major runtime changes.
- Do not treat README text as authority when canonicals disagree.
- Preserve governed terminology and explicit status classification.
- Treat logging and writeback as part of execution, not afterthoughts.
- Prefer validation evidence over narrative certainty.
- Keep module boundaries explicit.
- Avoid bypassing the canonical chain with route-local improvisation.

## Governed GitHub File Updates

The runtime exposes a backend-protected GitHub write helper for HTTP clients:

`POST /github/apply-file-updates`

For AI-agent workflows that should not write directly to `main`, prefer:

`POST /github/validated-apply-file-updates`

Required environment:
- `BACKEND_API_KEY`
- `GITHUB_TOKEN`

Example payload:

```json
{
  "owner": "mad4bdigital-ai",
  "repo": "multi-business-multi-role-growth-intelligence-os",
  "branch": "main",
  "message": "Apply governed file update",
  "files": [
    {
      "path": "README.md",
      "content": "new file contents"
    }
  ]
}
```

Files are applied in one commit through GitHub's Git Trees API. Use `content_base64` instead of `content` when sending pre-encoded content.

The validated route requires `base_branch` and a different `branch`. It creates the branch when missing, applies the file updates as one commit on that branch, opens a draft pull request by default, and lets GitHub Actions act as the validation gate before merge.

## Immediate next implementation focus

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

For ongoing operations:
- from `http-generic-api/`, run `npm test` after every code change (46+ test files, 800+ assertions)
- from `http-generic-api/`, run `npm run validate` to check architecture invariants
- run `node validate-memory-schema.mjs` after memory schema changes
- from `http-generic-api/`, run `npm run verify` (with `RUNTIME_BASE_URL`) after every deployment - see [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)
- CI runs automatically on every push/PR (canonical checks -> memory schema refs -> syntax -> tests -> architecture drift -> export floor)

This repository should be approached as a governed operating model with executable runtime modules, not as a conventional app-first project.
