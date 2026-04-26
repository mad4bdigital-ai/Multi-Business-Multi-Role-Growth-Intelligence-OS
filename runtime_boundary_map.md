# Runtime Boundary Map
**Purpose:** Describe the current runtime structure by authority boundary, not by incidental file grouping.

## 1. Canonical authority layer

These files define the intended architecture and enforcement model:

- `system_bootstrap.md`
- `memory_schema.json` (root; domain sub-schemas in `schemas/`)
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

These documents outrank runtime summaries and root documentation.

## 2. Root runtime boundary

### Current top-level service subtree

Primary implementation subtree:
- [`http-generic-api`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api>)

### Current orchestration boundary

- [`http-generic-api/server.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/server.js>)

Current role:
- Express route surface
- top-level request normalization and guardrails
- local dispatch and route selection
- registry-backed execution orchestration
- async job route coordination
- WordPress migration entrypoint coordination

Current risk:
- too many authority boundaries remain concentrated here

## 3. Shared runtime support boundaries

### Configuration boundary

- [`http-generic-api/config.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/config.js>)

Owns:
- environment-derived constants
- spreadsheet IDs
- sheet names
- service version
- queue and retry defaults
- GitHub connector configuration

### General utility boundary

- [`http-generic-api/utils.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/utils.js>)

Owns:
- request/path/method normalization
- URL building
- trace ID creation
- safe basic conversions
- low-level request hygiene helpers

### Normalization boundary

- [`http-generic-api/normalization.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/normalization.js>)

Owns:
- `/http-execute` payload normalization helpers
- top-level routing field normalization
- delegated wrapper payload promotion
- payload integrity comparison
- top-level routing validation contract
- asset-home payload validation contract
- Hostinger target-tier normalization guard

### Registry resolution boundary

- [`http-generic-api/registryResolution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registryResolution.js>)

Owns:
- registry-backed policy value/list resolution
- brand, parent-action, and endpoint resolution helpers
- delegated-transport classification and endpoint execution snapshots
- execution eligibility and transport boundary enforcement helpers
- provider-domain resolution contract for delegated and brand-bound execution

### Registry Sheets read-model boundary

- [`http-generic-api/registrySheets.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registrySheets.js>)

Owns:
- registry Sheets row loading for brand, hosting-account, action, endpoint, and execution-policy surfaces
- registry surface catalog lookup by `surface_id`
- live execution-policy registry read-model helpers
- execution-policy row shaping and row-number resolution helpers

### Registry mutation boundary

- [`http-generic-api/registryMutations.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registryMutations.js>)

Owns:
- governed CRUD flow wrappers for registry surfaces
- live-read plus row-build plus row-locate orchestration for registry mutations
- task-route, workflow, registry-surface, validation-repair, action, and execution-policy registry mutation entrypoints
- canonical row shaping and record identity matching for governed registry writes

### Governed sheet-write primitive boundary

- [`http-generic-api/governedSheetWrites.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedSheetWrites.js>)

Owns:
- governed write safety-plan construction from live headers and row-2 formulas
- full-row and slice-row shaping for governed writes
- append, update, and delete primitives for governed sheet mutations
- `Execution Log Unified` append/writeback special handling
- shared mutation dispatch after governance preflight succeeds

### Governed change-control helper boundary

- [`http-generic-api/governedChangeControl.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedChangeControl.js>)

Owns:
- governed change-control policy loading from `Execution Policy Registry`
- governed policy value/enabled resolution helpers
- existing-row window reads for duplicate detection
- semantic normalization and duplicate-candidate discovery used by governed mutation preflight

### Surface metadata and header-validation boundary

- [`http-generic-api/surfaceMetadata.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/surfaceMetadata.js>)

Owns:
- sheet-cell normalization for governed write surfaces
- live sheet shape reads and header-map derivation
- canonical surface metadata fallback and registry-backed resolution
- header signature, expected-column, and exact-header validation helpers
- reusable header hashing helpers for drift and repair workflows

### Route/Workflow governance boundary

- [`http-generic-api/routeWorkflowGovernance.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/routeWorkflowGovernance.js>)

Owns:
- canonical Task Routes and Workflow Registry header-order enforcement
- legacy route/workflow write blocking and migration-scaffolding guardrails
- governed addition-state normalization and review result shaping
- sheet bootstrapping and append-if-missing helpers for canonical route/workflow surfaces
- site-migration registry-surface and route/workflow readiness validation

### Route/Workflow registry read-model boundary

- [`http-generic-api/routeWorkflowRegistryModels.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/routeWorkflowRegistryModels.js>)

Owns:
- Task Routes registry row shaping into governed runtime records
- Workflow Registry row shaping into governed runtime records
- executable-authority evaluation for route/workflow records
- candidate-inspection versus executable-only filtering for route/workflow loaders

### Governed record-resolution boundary

- [`http-generic-api/governedRecordResolution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedRecordResolution.js>)

Owns:
- generic governed-sheet record loading by surface name
- loose hostname normalization and identity matching across governed registries
- Brand Registry binding resolution from governed records
- Hostinger SSH runtime lookup from Hosting Account Registry

### Schema validation boundary

- [`http-generic-api/schemaValidation.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/schemaValidation.js>)

Owns:
- authoritative OpenAPI operation resolution by method and path template
- request parameter and request-body schema validation
- JSON-schema-style structural validation helpers
- response schema drift classification for schema-bound executions

### Auth injection boundary

- [`http-generic-api/authInjection.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/authInjection.js>)

Owns:
- OAuth-configured action detection
- auth-mode inference from action and brand records
- auth header construction for basic, bearer, and custom-header modes
- query/header auth injection helpers for execution and schema validation

### Async job infrastructure boundary

- [`http-generic-api/queue.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/queue.js>)
- [`http-generic-api/jobRunner.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/jobRunner.js>)

Owns:
- Redis and BullMQ setup
- job persistence and idempotency
- worker entrypoints
- webhook delivery
- retry decisions
- site-migration job record creation

## 4. Registry and governed-write boundaries

### Google client boundary

- [`http-generic-api/googleSheets.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/googleSheets.js>)

Owns:
- Google Sheets and Drive client creation
- range reads
- sheet creation/header assurance
- live sheet shape inspection

### Registry read-model boundary

- [`http-generic-api/registry.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registry.js>)

Owns:
- registry surface metadata reads
- governed sink existence checks
- sheet-range helpers
- registry row loading and normalization
- canonical surface metadata lookup

### Governed writeback boundary

- [`http-generic-api/governed.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governed.js>)

Owns:
- header validation
- governed write-plan construction
- formula/protected column safety checks
- sink row spill-safety rules

### Mutation governance boundary

- [`http-generic-api/mutationGovernance.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/mutationGovernance.js>)

Owns:
- governed mutation intent classification
- governed target-row resolution
- governed mutation preflight enforcement contract
- duplicate-candidate summary shaping

### Execution result and sink-shaping boundary

- [`http-generic-api/execution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/execution.js>)

Owns:
- execution-result classification
- output summary shaping
- oversized artifact handling
- `Execution Log Unified` row shaping
- `JSON Asset Registry` row shaping

### Sink orchestration boundary

- [`http-generic-api/sinkOrchestration.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/sinkOrchestration.js>)

Owns:
- oversized artifact persistence orchestration
- shared writeback orchestration for authoritative sink flows
- coordination of `Execution Log Unified` and `JSON Asset Registry` writes
- governed sink state aggregation for runtime writeback results

### Sink verification boundary

- [`http-generic-api/sinkVerification.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/sinkVerification.js>)

Owns:
- execution-log spill-safety checks
- sink append readback verification
- authoritative sink write helper wrappers for `Execution Log Unified` and `JSON Asset Registry`
- sink-specific live header and write verification logic

## 5. Auth and connector boundaries

### Auth and policy resolution boundary

- [`http-generic-api/auth.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/auth.js>)

Owns:
- Google delegated token minting
- auth-mode and scope resolution
- required policy checks for execution readiness

### GitHub connector boundary

- [`http-generic-api/github.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/github.js>)

Owns:
- GitHub blob reads
- chunked payload fetch behavior
- GitHub token-gated helper behavior

Desired contract direction:
- narrow public entrypoints
- helper privacy by default

### Hostinger connector boundary

- [`http-generic-api/hostinger.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/hostinger.js>)

Owns:
- Hosting Account Registry lookup for Hostinger runtime/SSH context
- runtime-read endpoint support

## 6. WordPress migration subsystem boundary

### Barrel and shared boundary

- [`http-generic-api/wordpress/index.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/index.js>)
- [`http-generic-api/wordpress/shared.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/shared.js>)

### CPT preflight boundary

- [`http-generic-api/wordpress-cpt-preflight.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress-cpt-preflight.js>)

Owns:
- WordPress CPT preflight asset-type inference
- CPT-aware JSON asset context shaping
- delegation to shared CPT preflight asset-key and payload helpers

### Orchestrator boundary

- [`http-generic-api/wordpress/phaseA.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/phaseA.js>)

Current role:
- top-level WordPress migration orchestration
- phase sequencing
- phase result aggregation
- evidence assembly for later phases

Current risk:
- still large and still centralizes too much subsystem authority

### Domain phase boundaries

- `phaseB.js`: builder assets
- `phaseC.js`: site settings
- `phaseD.js`: forms and integrations
- `phaseE.js`: media assets
- `phaseF.js`: users, roles, auth surface
- `phaseG.js`: SEO surfaces
- `phaseH.js`: analytics and tracking
- `phaseI.js`: performance optimization
- `phaseJ.js`: security, headers, hardening
- `phaseK.js`: observability, logs, alerts, monitoring
- `phaseL.js`: backup and recovery
- `phaseM.js`: deployment, release, rollback
- `phaseN.js`: data integrity and reconciliation
- `phaseO.js`: QA, smoke tests, acceptance
- `phaseP.js`: production readiness and cutover

## 7. Governed sinks and authoritative surfaces

Current primary sink surfaces:
- `Execution Log Unified`
- `JSON Asset Registry`

Current important authority surfaces:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Brand Registry`
- `Hosting Account Registry`
- `Brand Core Registry`

## 8. Schema boundary

`memory_schema.json` is the persistent state contract root. It is decomposed into 11 domain sub-schemas under `schemas/`, each containing the relevant `$defs`:

| File | Defs | Size |
|---|---|---|
| `schemas/shared.schema.json` | 3 | 1.5 KB |
| `schemas/business_identity.schema.json` | 2 | 4.1 KB |
| `schemas/brand.schema.json` | 8 | 19 KB |
| `schemas/execution.schema.json` | 12 | 39 KB |
| `schemas/analytics.schema.json` | 17 | 20 KB |
| `schemas/governance.schema.json` | 3 | 4.4 KB |
| `schemas/repair_audit.schema.json` | 11 | 34 KB |
| `schemas/routing_transport.schema.json` | 2 | 7.7 KB |
| `schemas/graph_addition.schema.json` | 9 | 15 KB |
| `schemas/operations.schema.json` | 13 | 125 KB |
| `schemas/wordpress_api.schema.json` | 3 | 6 KB |

Root retains 123 properties and 92 required fields. All 169 `$ref` values resolve.

## 9. Immediate decomposition opportunities

The next highest-value decomposition opportunities are:

1. reduce remaining route-local execution/auth policy assembly in `server.js`
2. reduce remaining auth-contract normalization and credential-resolution helpers in `server.js`
3. reduce `phaseA.js` orchestration weight where a stricter per-phase contract allows it
4. tighten connector public/private export boundaries
5. continue converting runtime helper clusters into explicit authority modules

## 9. Boundary rules for future changes

- Add code by authority boundary first, not by convenience.
- Keep sink-handling logic centralized when it governs multiple runtime paths.
- Keep connector entrypoints narrow and explicit.
- Do not move canonical authority into runtime helper files.
- Prefer shared normalization contracts over route-local literal handling.
