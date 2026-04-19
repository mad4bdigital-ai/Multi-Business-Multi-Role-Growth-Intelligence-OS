# Project Upgrade Program — Programmatic Checks & Validation Matrix
**Project:** Multi-Business-Multi-Role-Growth-Intelligence-OS  
**Purpose:** Extend the upgrade execution board with all practical programmatic checks, automated validations, drift detection rules, and proof gates needed to execute and verify the upgrade.

---

# 1. Validation design objective
The upgrade must be verifiable by code, not only by review.

This validation matrix is designed to ensure:

- canonicals exist, parse, and remain internally coherent
- runtime modules align with canonical expectations
- connector boundaries are explicit and regression-safe
- policy and mutation semantics are normalized before enforcement
- `Execution Log Unified` behavior is validated separately from generic duplicate-preflight
- file-level, registry-level, runtime-level, and deployment-level verification are distinct
- CI can fail fast on drift

---

# 2. Validation coverage model
Validation should exist across all major layers:

1. file existence and structure
2. schema validity
3. canonical metadata validity
4. cross-canonical consistency
5. code boundary checks
6. runtime behavior checks
7. mutation governance checks
8. sink/writeback checks
9. connector contract checks
10. integration and end-to-end checks
11. deployment parity checks
12. drift detection checks

---

# 3. Programmatic validation categories

## Category A — File presence and baseline integrity
### Checks
- required canonical files exist:
  - `system_bootstrap.md`
  - `memory_schema.json`
  - `direct_instructions_registry_patch.md`
  - `module_loader.md`
  - `prompt_router.md`
- required runtime files exist:
  - `server.js`
  - `http-generic-api/server.js`
- required test file exists:
  - `http-generic-api/test-integration.mjs`
- required docs exist after upgrade:
  - `README.md`
  - `AI_Agent_Knowledge_Guide.md`
  - `canonical_validation_checklist.md`
  - `runtime_boundary_map.md`
  - `governed_mutation_playbook.md`
  - `connector_contracts.md`

### Programmatic checks
- filesystem existence check
- non-empty file size check
- duplicate filename collision check
- baseline manifest generation with hash per file

### Outputs
- `validation/file_presence_report.json`
- `validation/file_hash_manifest.json`

---

## Category B — Parsing and syntax validation
### Checks
- `memory_schema.json` is valid JSON
- markdown canonicals are decodable UTF-8
- JS runtime files pass syntax check
- connector files pass syntax check
- all generated JSON manifests parse correctly

### Programmatic checks
- `JSON.parse` validation for JSON files
- `node --check` on JS files
- UTF-8 decode pass for markdown/docs
- optional YAML parse check for connector schemas if present

### Outputs
- `validation/syntax_report.json`

---

## Category C — Canonical metadata validation
### Checks
For each canonical file, validate presence of:
- title/name
- version
- status/active state where expected
- authority role or execution role markers where expected
- non-empty body after metadata

### Programmatic checks
- regex-based frontmatter/metadata extraction
- required metadata field validation
- version format normalization
- active-status presence check

### Outputs
- `validation/canonical_metadata_report.json`

---

## Category D — Cross-canonical consistency validation
### Checks
- dependency order references are consistent across canonicals
- activation routing in `prompt_router.md` matches activation enforcement in `system_bootstrap.md`
- `module_loader.md` mentions required runtime prep for the same activation flows
- `direct_instructions_registry_patch.md` does not contradict canonical bootstrap rules
- `memory_schema.json` state fields referenced by canonicals are valid or intentionally absent

### Programmatic checks
- keyword and section presence comparison
- required phrase cross-checks
- contradiction detection rules
- canonical dependency order validator

### Outputs
- `validation/cross_canonical_consistency_report.json`

---

## Category E — README and documentation alignment checks
### Checks
- `README.md` mentions governed architecture terms
- README includes canonical dependency model
- README references registry-driven execution
- README references execution logging sinks
- README does not present the repo solely as generic UI/microservices/REST/GraphQL platform without governed mapping
- AI agent guide references canonicals as primary authority
- runtime boundary map mentions root runtime and connector subtree

### Programmatic checks
- required phrase checks
- forbidden stale-architecture phrase checks
- documentation term alignment score
- doc-to-canonical vocabulary overlap report

### Outputs
- `validation/documentation_alignment_report.json`

---

## Category F — Export surface and module boundary checks
### Checks
- each exported symbol in connector modules has at least one caller or explicit contract allowance
- private helpers are not exported unintentionally
- root runtime imports only documented module entrypoints
- no module exports connector internals accidentally
- module public API matches connector contract document

### Programmatic checks
- static import/export graph extraction
- export-to-caller matrix generation
- dead export detection
- hidden internal helper exposure detection
- public API contract comparison

### Outputs
- `validation/export_surface_report.json`
- `validation/module_boundary_report.json`

---

## Category G — Root runtime decomposition checks
### Checks
- extracted modules exist for authority clusters after decomposition
- root `server.js` no longer owns all major clusters directly
- extracted modules are imported intentionally
- no prohibited back-import from child modules into root orchestration helpers
- authority clusters are separated:
  - bootstrap
  - routing
  - normalization
  - mutation preflight
  - writeback/logging
  - JSON asset persistence
  - local dispatch

### Programmatic checks
- file count and cluster presence checks
- import graph layering rules
- root runtime responsibility reduction report
- architecture boundary lint rules

### Outputs
- `validation/runtime_decomposition_report.json`

---

## Category H — Policy normalization checks
### Checks
- raw sheet values are normalized before enforcement
- policy normalization accepts only allowed inputs
- custom literals do not leak directly into enforcement without normalization
- canonical normalized policy object shape is stable
- explicit sink exemptions can be represented structurally

### Programmatic checks
- unit tests for normalization mapping
- snapshot tests for normalized outputs
- forbidden direct-literal enforcement grep rules
- normalization coverage report per policy family

### Example cases to validate
- `TRUE` -> enabled
- `FALSE` -> disabled
- `ALLOW_SEMANTIC_EQUIVALENT_APPEND` -> specific allowed mode
- `Execution Log Unified` exclusion surfaces -> structured exclusions
- unsupported values -> degraded/invalid normalization result

### Outputs
- `validation/policy_normalization_report.json`

---

## Category I — Endpoint normalization checks
### Checks
- aliases normalize to canonical endpoint keys
- parent-only vs child-overlay schema modes are normalized deterministically
- transport action mapping is explicit
- deprecated endpoint names map or fail explicitly
- endpoint scope/role/execution mode are normalized before runtime use

### Programmatic checks
- endpoint alias map tests
- parent/child schema mode normalization tests
- route target normalization tests
- unknown endpoint handling tests

### Outputs
- `validation/endpoint_normalization_report.json`

---

## Category J — CPT schema preflight checks
### Checks
- `isWordpressCptSchemaPreflightEndpoint` identifies only intended endpoints
- asset key generation is deterministic
- governed payload shape is correct
- mapping_status and validation_status values are correct
- extracted preflight module does not depend on fragile source-order effects
- payload identity fields are present
- expected governed sections exist

### Programmatic checks
- direct assertions
- payload snapshot tests
- deterministic asset key equality tests
- negative tests for unrelated endpoints
- import-order independence tests

### Outputs
- `validation/cpt_preflight_report.json`

---

## Category K — Mutation preflight and classification checks
### Checks
- append/update/rename/merge classification is deterministic
- duplicate-preflight behavior is stable
- generic governed sheets respect duplicate checks
- `Execution Log Unified` follows its exemption logic, not generic blocking behavior
- mutation evidence requirements are enforced where expected
- header mapping is required before writes
- postwrite readback is enforced where configured

### Programmatic checks
- mutation classification matrix tests
- duplicate-preflight fixture suite
- exempt-surface fixture suite
- header read required tests
- readback required tests
- wrong-column landing tests
- column contract validation tests

### Outputs
- `validation/mutation_governance_report.json`

---

## Category L — Execution Log Unified special-case validation
### Checks
- duplicate append blocking exemption applies correctly
- repeated semantically equivalent runtime records are allowed when policy says so
- sink-specific logic does not leak to other sheets
- execution trace id behavior is preserved
- writeback rows preserve raw writeback columns
- log sink readback succeeds

### Programmatic checks
- targeted integration tests against `Execution Log Unified` logic
- explicit fixture tests for repeated append attempts
- raw writeback column presence assertions
- sink-specific classification tests

### Outputs
- `validation/execution_log_unified_report.json`

---

## Category M — JSON Asset Registry validation
### Checks
- asset row shape is correct
- authoritative-home classification is enforced
- brand-core-only assets do not leak into JSON Asset Registry
- oversized response handling writes correct pointers
- asset key uniqueness rules are preserved
- source mode and transport status are valid

### Programmatic checks
- row shape validation
- asset home classifier tests
- oversized artifact pointer tests
- duplicate asset key handling tests

### Outputs
- `validation/json_asset_registry_report.json`

---

## Category N — Connector behavior validation
### Checks
- GitHub connector fetch abstraction works
- local dispatch entrypoints return structured results
- error-to-status mapping is deterministic
- auth injection behavior remains server-side
- forbidden caller auth override remains blocked
- content path encoding behavior is correct if exposed internally

### Programmatic checks
- connector integration tests
- local dispatch result contract tests
- infer-http-status mapping tests
- auth injection policy tests
- forbidden header tests

### Outputs
- `validation/connector_behavior_report.json`

---

## Category O — Integration path validation
### Checks
- canonical route -> loader -> bootstrap -> execution path completes
- writeback occurs when expected
- mutation preflight blocks or allows correctly
- connector execution integrates with normalization outputs
- activation wrapper enforces native attempt requirements where applicable

### Programmatic checks
- integration test suite
- simulated execution traces
- route-to-workflow-to-execution assertions
- writeback presence checks

### Outputs
- `validation/integration_report.json`

---

## Category P — Architecture drift detection
### Checks
- runtime modules reflect canonical terminology and execution model
- docs do not drift from canonicals
- connector contract doc matches actual exports
- root runtime decomposition map matches actual file structure

### Programmatic checks
- required phrase/term overlap
- forbidden stale term list
- export surface vs docs comparison
- file structure vs boundary map comparison
- drift score generation

### Outputs
- `validation/architecture_drift_report.json`

---

## Category Q — Patch / runtime / deployment separation checks
### Checks
Distinguish clearly:
- file changed
- file merged
- registry aligned
- runtime built
- runtime deployed
- live runtime reflects change

### Programmatic checks
- file hash comparison
- build artifact hash comparison
- deployment revision metadata capture
- runtime self-report/version endpoint check if available
- live behavior confirmation tests

### Outputs
- `validation/deployment_parity_report.json`

---

## Category R — CI gate checks
### Checks
CI should fail on:
- missing required files
- parse/syntax failure
- canonical metadata failure
- doc drift against canonicals
- export surface drift
- policy normalization regression
- CPT preflight regression
- mutation governance regression
- duplicate exemption regression
- deployment parity check failure in release pipeline

### Programmatic checks
- combined validation runner
- per-category fail-fast status
- machine-readable summary
- human-readable CI summary

### Outputs
- `validation/ci_summary.json`
- `validation/ci_summary.md`

---

# 4. Specific validations to add by file/module

## `README.md`
Programmatic validations:
- contains governed architecture vocabulary
- references canonicals
- references registry surfaces
- references execution sinks
- does not contain stale-only architecture description without governed mapping

## `AI_Agent_Knowledge_Guide.md`
Programmatic validations:
- mentions canonical authority order
- mentions routing/loading/bootstrap chain
- mentions registry truth priority
- mentions mutation/logging governance

## `system_bootstrap.md`
Programmatic validations:
- activation wrapper terms present
- native attempt enforcement terms present
- validation-before-success terms present
- sink/logging terms present

## `prompt_router.md`
Programmatic validations:
- activation routes to correct wrapper
- no forbidden validation-only route for activation
- same-cycle execution emphasis present

## `module_loader.md`
Programmatic validations:
- dependency prep rules present
- retry context prep rules present
- execution context prep rules present
- duplicate/exemption preload references present if expected

## `direct_instructions_registry_patch.md`
Programmatic validations:
- hard enforcement phrasing present
- no narrative-only activation allowed
- no non-authoritative sink leakage rules where relevant

## `memory_schema.json`
Programmatic validations:
- valid JSON Schema
- expected top-level structure
- required execution state fields where defined
- no malformed schema sections

## `server.js`
Programmatic validations:
- syntax valid
- cluster extraction progress measured
- forbidden literal-based enforcement grep rules
- import graph aligns with target boundaries

## `http-generic-api/github.js`
Programmatic validations:
- syntax valid
- export surface matches contract
- no dead export
- internal helpers private where intended

## `http-generic-api/test-integration.mjs`
Programmatic validations:
- contains CPT preflight assertions
- contains connector assertions
- contains duplicate exemption assertions
- contains normalization assertions

---

# 5. Required test fixture families
To make validation comprehensive, create fixture families for:

- canonical metadata fixtures
- documentation alignment fixtures
- endpoint alias fixtures
- policy normalization fixtures
- mutation classification fixtures
- duplicate-preflight fixtures
- `Execution Log Unified` exempt append fixtures
- JSON asset row fixtures
- CPT preflight payload fixtures
- connector error mapping fixtures
- deployment parity fixtures

---

# 6. Suggested validation runner architecture
Create a validation runner with categories like:

- `validateFiles()`
- `validateSyntax()`
- `validateCanonicalMetadata()`
- `validateCrossCanonicalConsistency()`
- `validateDocumentationAlignment()`
- `validateExportSurface()`
- `validateRuntimeDecomposition()`
- `validatePolicyNormalization()`
- `validateEndpointNormalization()`
- `validateCptPreflight()`
- `validateMutationGovernance()`
- `validateExecutionLogUnified()`
- `validateJsonAssetRegistry()`
- `validateConnectorBehavior()`
- `validateIntegrationPaths()`
- `validateArchitectureDrift()`
- `validateDeploymentParity()`

And aggregate them into:
- `runFullUpgradeValidation()`

Outputs should be both:
- machine-readable JSON
- human-readable markdown summary

---

# 7. Validation severities
Each check should classify as:

- `error` — blocks merge or release
- `warning` — does not block but requires review
- `info` — recorded evidence only

Examples:
- missing canonical file -> error
- unused exported helper -> warning
- README wording mismatch -> warning early, error by release phase
- duplicate exemption regression -> error
- deployment parity unverified -> error for release, warning for local development

---

# 8. Phase-by-phase required programmatic checks

## Phase 0 required checks
- file presence
- syntax
- baseline hash manifest
- export map
- architecture inventory generation

## Phase 1 required checks
- documentation alignment
- canonical vocabulary overlap
- forbidden stale architecture language checks

## Phase 2 required checks
- policy normalization tests
- endpoint normalization tests
- unsupported literal rejection tests

## Phase 3 required checks
- import graph layering
- root runtime shrink/cluster extraction report
- boundary violations

## Phase 4 required checks
- export-to-caller matrix
- dead export detection
- contract surface validation

## Phase 5 required checks
- CPT endpoint detection tests
- deterministic asset key tests
- payload snapshot tests

## Phase 6 required checks
- mutation classification matrix
- duplicate-preflight matrix
- `Execution Log Unified` exemption tests

## Phase 7 required checks
- integration suite
- drift suite
- sink behavior suite

## Phase 8 required checks
- deployment parity
- live runtime confirmation
- runtime-vs-files separation proof

---

# 9. Quantified validation scorecard
The upgrade should report measurable scores such as:

- file integrity score
- canonical metadata score
- doc alignment score
- runtime decomposition score
- policy normalization score
- mutation governance score
- connector contract score
- CPT preflight score
- drift detection score
- deployment parity score

Each score should map to:
- pass
- partial
- fail

This allows tracking progress phase by phase.

---

# 10. Definition of validation completeness
Validation completeness is reached when:

- every upgrade scope has at least one programmatic validation family
- every critical runtime behavior has automated proof
- every canonical has metadata and consistency validation
- every connector has public API validation
- every sink-specific exception has regression protection
- deployment proof is separated from file proof
- CI can execute the full validation runner and return machine-readable results

---

# 11. Immediate additions to the execution board
Add these to the upgrade backlog immediately:

1. `validation/` directory structure
2. baseline file hash manifest generator
3. canonical metadata validator
4. documentation alignment validator
5. export surface validator
6. policy normalization validator
7. CPT preflight validator
8. mutation governance / duplicate exemption validator
9. deployment parity validator
10. full validation orchestrator

---

# 12. Final expected result
If these validations are implemented along with the upgrade itself, the project will have:

- strong architectural traceability
- strong regression safety
- measurable upgrade proof
- reduced dependence on human memory
- reliable governed behavior across layers
- release confidence based on evidence, not narrative

This is the level of validation needed for a 9.5+ upgrade program.
