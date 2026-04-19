# Project Upgrade Preparation Baseline
**Project:** Multi-Business-Multi-Role-Growth-Intelligence-OS  
**Prepared:** 2026-04-19  
**Purpose:** Phase 0 preparation for implementing `project_upgrade_end_to_end_plan.md`

## 1. Inputs reviewed

### Reviewed and present
- `project_upgrade_end_to_end_plan.md`
- `AI_Agent_Knowledge_Guide.md`
- `system_bootstrap.md`
- `memory_schema.json` as authoritative canonical contract reference
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`
- `http-generic-api/README.md`
- `http-generic-api/PROJECT_INTEGRATION_CHECKLIST.md`
- `http-generic-api/TEMP_SPRINT_1_STABILIZATION_REPORT.md`

### Requested but not present in repository
- `project_upgrade_programmatic_validation_matrix.md`
- `project_upgrade_execution_board_9_5_plus.md`

## 2. Canonical authority order

Per `AI_Agent_Knowledge_Guide.md`, upgrade implementation should follow this authority order:

1. `system_bootstrap.md`
2. `memory_schema.json`
3. `direct_instructions_registry_patch.md`
4. `module_loader.md`
5. `prompt_router.md`

Supporting but secondary:
- root/runtime implementation files
- `http-generic-api/*`
- `README.md`

## 3. Current baseline architecture inventory

### Repo root
- Canonical and governance-heavy root documents are present.
- Root `README.md` is still generic and does not describe the governed runtime accurately.
- The main executable subtree currently visible is `http-generic-api/`.

### Connector/runtime subtree
- `http-generic-api/server.js` remains the main orchestration surface.
- Current observed line count of `http-generic-api/server.js`: about `9,061` lines.
- Runtime responsibilities currently span:
  - request normalization and guardrails
  - registry reads
  - governed writeback handling
  - execution logging and JSON asset persistence
  - async job orchestration
  - WordPress site-migration orchestration

### WordPress migration subsystem
- `http-generic-api/wordpress/index.js` re-exports `shared.js` and phase modules `A` through `P`.
- `phaseA.js` still acts as the top-level WordPress migration orchestrator.
- Phases `B` through `P` are modularized by domain.
- `test-integration.mjs` exists as a lightweight smoke/integration harness.

## 4. Current ownership map

### Root authority and canonical docs
- `system_bootstrap.md`: orchestration authority
- `prompt_router.md`: routing authority
- `module_loader.md`: loading and readiness authority
- `direct_instructions_registry_patch.md`: hard enforcement authority
- `memory_schema.json`: persistent state contract

### `http-generic-api` runtime modules
- `server.js`: top-level route orchestration and cross-module coordination
- `config.js`: environment contract
- `utils.js`: low-level request and normalization utilities
- `auth.js`: policy-aware auth and Google delegated token handling
- `registry.js`: registry and surface metadata read model
- `googleSheets.js`: low-level Google Sheets and Drive access
- `governed.js`: governed writeback and schema-safety enforcement
- `execution.js`: execution status, artifact, and sink row shaping
- `queue.js`: Redis and BullMQ queue infrastructure
- `jobRunner.js`: async job orchestration and webhook handling
- `github.js`: GitHub connector helper
- `hostinger.js`: Hostinger runtime registry lookup helper

### WordPress migration phases
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
- `phaseP.js`: final orchestration, production readiness, cutover

## 5. Governed sink map

Primary governed sinks and surfaces observed from canonicals and runtime:
- `Execution Log Unified`
- `JSON Asset Registry`
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

Observed sink-handling runtime modules:
- `execution.js`
- `governed.js`
- `registry.js`
- `googleSheets.js`
- portions of `server.js`

## 6. Current drift list

### Documentation drift
- `README.md` still describes a generic application stack rather than the actual governed, registry-driven architecture.
- Root docs recommended by `AI_Agent_Knowledge_Guide.md` do not yet exist:
  - `canonical_validation_checklist.md`
  - `runtime_boundary_map.md`
  - `governed_mutation_playbook.md`
  - `connector_contracts.md`

### Runtime concentration drift
- `http-generic-api/server.js` remains large and still owns too many authority boundaries directly.
- `phaseA.js` remains a very large orchestrator in the WordPress migration subsystem.

### Normalization drift
- Canonicals call for normalized canonical objects and explicit governed classifications.
- Current runtime still appears to rely in places on literal policy strings, direct sheet values, and route-local logic.

### Boundary drift
- Several extracted modules are still marked as auto-extracted from `server.js`.
- Public/private module contract hygiene is not yet fully formalized across all runtime helpers.

### Validation and test drift
- Lightweight integration coverage exists, but the upgrade plan calls for stronger drift checks, contract checks, and CI-detectable architectural verification.
- The requested programmatic validation matrix file is missing, so a complete validation mapping cannot yet be reviewed from repo contents.

### Input completeness drift
- The requested execution board file is missing, so sprint/task sequencing cannot yet be validated against an authoritative execution board artifact.

## 7. Canonical implications for implementation

### Non-bypass requirement
The canonicals consistently require:
- governed routing first
- governed loading/readiness second
- governed bootstrap/enforcement third
- runtime execution after that
- governed logging and persistence as part of execution

This means upgrade implementation should not start with isolated code cleanup alone. It should preserve and strengthen the canonical chain.

### Evidence-first requirement
The canonicals strongly favor:
- live validation over narrative
- explicit degraded or blocked classification over implied success
- evidence classes over broad success wording

This has direct implications for:
- logging/output schemas
- mutation preflight behavior
- testing strategy
- documentation wording

## 8. Recommended first implementation slice

To stay aligned with `project_upgrade_end_to_end_plan.md`, the safest first slice is:

1. Complete Phase 0 baseline artifacts
2. Complete Phase 1 documentation alignment
3. Define the normalization-layer target contract before deeper decomposition

Concretely, the first code-and-doc work package should be:
- rewrite `README.md`
- add `canonical_validation_checklist.md`
- add `runtime_boundary_map.md`
- add `governed_mutation_playbook.md`
- define a normalization target document or module contract for:
  - policy state
  - endpoint identity
  - execution classification
  - mutation classification
  - sink exemptions

## 9. Blocking and missing inputs

The following requested review inputs are currently missing from the repository:
- `project_upgrade_programmatic_validation_matrix.md`
- `project_upgrade_execution_board_9_5_plus.md`

Implementation can begin without them, but review coverage is incomplete until:
- the exact files are added, or
- equivalent renamed artifacts are identified by the user

## 10. Immediate next actions

- Treat this file as the baseline inventory for Phase 0.
- Use canonical authority order for all upgrade decisions.
- Start Phase 1 by aligning documentation to the governed architecture already present in code and canonicals.
- Do not claim full validation-matrix or execution-board review until the missing files are provided or located under different names.
