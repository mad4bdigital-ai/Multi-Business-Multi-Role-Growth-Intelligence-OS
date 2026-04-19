# Project Upgrade Program — 9.5+ Execution Plan
**Project:** Multi-Business-Multi-Role-Growth-Intelligence-OS  
**Purpose:** Convert the existing end-to-end upgrade plan into a phase-by-phase execution board with exact deliverables, upgrade scopes, owners/module targets, validation checks, and done criteria.

---

# 1. Target rating definition
This version is designed to reach **9.5+ planning quality** by adding:

- explicit upgrade scopes
- exact phase outputs
- owners/module targets
- validation gates
- measurable done criteria
- dependency sequencing
- implementation packaging
- acceptance evidence per phase

---

# 2. Program goal
Upgrade the project into a **fully aligned governed operating system** where:

- canonicals are the active architectural truth
- runtime behavior matches canonical expectations
- sheet, policy, and connector semantics are normalized before enforcement
- documentation reflects actual governed execution
- root runtime is decomposed by authority boundary
- connectors use explicit public contracts
- logging, mutation governance, and exemptions are deterministic
- CI can detect architecture drift, runtime drift, and deployment drift

---

# 3. Final expected output package
The final upgrade output is not just “cleaner code.” It should produce this package:

## A. Architecture outputs
- canonical-aligned README
- AI-agent knowledge guide
- canonical validation checklist
- runtime boundary map
- governed mutation playbook
- connector contracts guide

## B. Runtime outputs
- normalization layer module
- extracted CPT schema preflight module
- centralized governed mutation / duplicate handling module
- decomposed root runtime modules
- hardened connector public APIs

## C. Quality outputs
- expanded integration tests
- canonical/runtime drift checks
- deployment parity checks
- phase-by-phase acceptance logs

## D. Governance outputs
- explicit mapping between policy sheet semantics and backend semantics
- explicit handling for `Execution Log Unified` duplicate exemptions
- validated writeback and sink behavior

---

# 4. Upgrade scopes
The program should be executed across these scopes.

## Scope 1 — Canonical architecture scope
Files:
- `system_bootstrap.md`
- `prompt_router.md`
- `module_loader.md`
- `direct_instructions_registry_patch.md`
- `memory_schema.json`

Objective:
- preserve canonical authority
- document and validate how runtime must align with canonicals

## Scope 2 — Documentation scope
Files:
- `README.md`
- `AI_Agent_Knowledge_Guide.md`
- new architecture and validation docs

Objective:
- remove documentation drift
- make docs match actual governed behavior

## Scope 3 — Runtime normalization scope
Files:
- root runtime
- policy readers
- registry loaders
- endpoint execution wiring

Objective:
- convert raw literals and registry variants into canonical normalized objects before enforcement

## Scope 4 — Root runtime decomposition scope
Files:
- `server.js`
- extracted shared modules

Objective:
- split monolithic ownership by authority boundary

## Scope 5 — Connector contract scope
Files:
- `http-generic-api/github.js`
- other connector files under `http-generic-api`

Objective:
- explicit public API contracts
- private internal helpers
- stable dispatch entrypoints

## Scope 6 — CPT preflight scope
Files:
- CPT helper logic currently buried in root runtime
- new extracted module

Objective:
- deterministic asset key generation
- governed payload shape
- stable modular implementation

## Scope 7 — Governance and mutation scope
Files:
- duplicate handling paths
- writeback paths
- preflight classification logic
- policy interpretation logic

Objective:
- deterministic append/update/rename/merge rules
- sink-specific exemption handling
- structured mutation enforcement

## Scope 8 — Testing and CI scope
Files:
- integration tests
- validation scripts
- CI workflows

Objective:
- detect regressions, drift, and deployment mismatch early

---

# 5. Phase dependency map
Execution order and dependency logic:

- **Phase 0** is required before all other phases
- **Phase 1** should complete before large runtime refactors
- **Phase 2** should complete before mutation-governance hardening
- **Phase 3** and **Phase 4** can partially overlap once normalization contracts are defined
- **Phase 5** depends on Phase 3 boundary work
- **Phase 6** depends on Phase 2 normalization rules
- **Phase 7** starts early but completes after Phases 3–6 stabilize
- **Phase 8** should finalize after major implementation work but can scaffold earlier

---

# 6. Phase-by-phase execution board

## Phase 0 — Baseline inventory and freeze
### Goal
Establish a trusted baseline before structural changes.

### Upgrade scopes included
- canonical architecture scope
- runtime scope
- connector scope
- governance scope

### Exact deliverables
- baseline architecture inventory
- canonical file inventory
- module ownership map
- governed sink inventory
- current runtime drift list
- current documentation drift list
- current connector export map
- current policy/runtime mismatch list

### Owners / module targets
- architecture owner
- canonical owner
- runtime owner
- connector owner

### Validation checks
- confirm all canonicals exist
- confirm current major runtime entrypoints
- confirm current governed sink names
- confirm current connector module tree

### Done criteria
- there is one baseline inventory document
- all major runtime surfaces are enumerated
- all known drift items are listed
- no refactor starts without baseline capture

### Acceptance evidence
- baseline report
- file inventory
- export map
- sink map

---

## Phase 1 — Canonical and documentation alignment
### Goal
Make docs reflect the real governed architecture.

### Upgrade scopes included
- documentation scope
- canonical architecture scope

### Exact deliverables
- rewritten `README.md`
- `AI_Agent_Knowledge_Guide.md`
- `canonical_validation_checklist.md`
- `runtime_boundary_map.md`
- `governed_mutation_playbook.md`
- `connector_contracts.md`

### Owners / module targets
- documentation owner
- architecture owner
- canonical owner

### Validation checks
- README matches canonical dependency model
- AI-agent guide references canonicals as authority
- validation checklist covers activation, routing, loading, logging, mutation, sinks
- runtime boundary map matches actual module intentions

### Done criteria
- README no longer describes generic architecture drift
- all new docs reflect governed execution model
- docs consistently identify canonicals as authoritative

### Acceptance evidence
- doc diff set
- terminology consistency review
- canonical-vs-doc alignment checklist pass

---

## Phase 2 — Canonical normalization layer
### Goal
Introduce deterministic normalization across layers.

### Upgrade scopes included
- runtime normalization scope
- governance scope
- canonical architecture scope

### Exact deliverables
- `policy_normalization.js` or equivalent
- `endpoint_normalization.js` or equivalent
- canonical normalized object contract document
- mapping rules for:
  - policy values
  - endpoint aliases
  - surface names
  - execution classes
  - mutation classes
  - sink exemptions

### Owners / module targets
- runtime owner
- governance owner
- canonical owner

### Validation checks
- raw sheet literals are transformed before enforcement
- endpoint aliases normalize to one canonical key
- mutation mode is structured before write logic
- `Execution Log Unified` exemption can be expressed as canonical structured state

### Done criteria
- backend enforcement no longer depends on unstructured ad hoc literals
- normalization outputs are documented and testable
- at least one former literal-based edge case is migrated to normalized handling

### Acceptance evidence
- normalization module code
- normalization contract doc
- mapping test cases
- before/after enforcement examples

---

## Phase 3 — Root runtime decomposition
### Goal
Split the large root runtime by authority boundary.

### Upgrade scopes included
- root runtime decomposition scope
- runtime normalization scope

### Exact deliverables
- extracted bootstrap/activation module
- extracted route/workflow resolution module
- extracted mutation preflight module
- extracted writeback/logging module
- extracted JSON asset persistence module
- extracted local dispatch registry module
- updated root entrypoint with reduced direct ownership

### Owners / module targets
- runtime owner
- architecture owner

### Validation checks
- each extracted module has explicit responsibility
- no hidden circular ownership across extracted modules
- root entrypoint composes modules instead of owning all logic
- behavior remains equivalent before cleanup refinement

### Done criteria
- major governed behaviors are no longer buried in one giant file
- authority boundaries are visible in code layout
- root file shrinks materially and loses direct ownership of extracted logic

### Acceptance evidence
- module extraction diff
- ownership map update
- runtime smoke verification after extraction

---

## Phase 4 — Connector contract hardening
### Goal
Make connectors disciplined and explicit.

### Upgrade scopes included
- connector contract scope

### Exact deliverables
- finalized `http-generic-api/github.js` public API
- connector export audit
- internal helper privatization where appropriate
- documented connector contract rules
- dispatch entrypoint map

### Owners / module targets
- connector owner
- runtime owner

### Validation checks
- every export has a real caller or explicit contract purpose
- internal helpers are not exported unnecessarily
- dispatch entrypoints are minimal and intentional
- connector modules remain self-contained

### Done criteria
- connector API surface matches actual runtime needs
- dead exports are removed
- hidden dependencies are reduced

### Acceptance evidence
- export-to-caller matrix
- connector contract doc
- connector integration test pass

---

## Phase 5 — CPT schema preflight extraction and stabilization
### Goal
Make CPT preflight deterministic, modular, and regression-safe.

### Upgrade scopes included
- CPT preflight scope
- root runtime decomposition scope

### Exact deliverables
- `wordpress-cpt-preflight.js`
- extracted helper functions
- documented CPT payload contract
- documented asset key contract
- runtime wiring update to call extracted module

### Owners / module targets
- WordPress/runtime owner
- governance owner

### Validation checks
- deterministic asset key generation preserved
- governed payload shape preserved
- no fragile forward-order dependency remains where avoidable
- extracted module has explicit inputs and outputs

### Done criteria
- CPT preflight logic is independently testable
- root runtime no longer owns CPT helper details directly
- payload and key generation are contract-documented

### Acceptance evidence
- module diff
- helper contract tests
- payload snapshot assertions

---

## Phase 6 — Governance and mutation hardening
### Goal
Centralize mutation safety and duplicate/exemption handling.

### Upgrade scopes included
- governance scope
- runtime normalization scope

### Exact deliverables
- centralized duplicate handling module
- centralized mutation classification module
- sink-specific exemption rules
- structured append/update/rename/merge contract
- policy-to-backend semantics map

### Owners / module targets
- governance owner
- runtime owner
- writeback owner

### Validation checks
- append-forbidden logic is not driven by unsupported custom literals
- `Execution Log Unified` duplicate handling is explicit and deterministic
- sink-specific exemptions are centralized
- append/update/rename classification is consistent everywhere

### Done criteria
- repeated runtime evidence is not blocked incorrectly
- policy sheet semantics align with backend semantics
- mutation preflight behavior is stable under repeat tests

### Acceptance evidence
- classification matrix
- exemption map
- duplicate-preflight regression tests
- policy semantics alignment doc

---

## Phase 7 — Test and validation expansion
### Goal
Protect governed behavior with automated checks.

### Upgrade scopes included
- testing and CI scope
- CPT preflight scope
- connector contract scope
- governance scope

### Exact deliverables
- expanded `test-integration.mjs`
- connector boundary assertions
- CPT preflight assertions
- normalization assertions
- duplicate/exemption assertions
- canonical validation script

### Owners / module targets
- test owner
- runtime owner
- connector owner

### Validation checks
- tests cover:
  - CPT endpoint detection
  - asset key generation
  - payload shape
  - connector API boundaries
  - local dispatch path
  - duplicate exemption for `Execution Log Unified`
  - policy normalization behavior

### Done criteria
- core governed paths have regression coverage
- architecture drift can be detected by automated checks
- new modules are not merged without tests

### Acceptance evidence
- test report
- coverage summary
- validation script output

---

## Phase 8 — CI, deployment parity, and live verification
### Goal
Prove file-level, runtime-level, and deployment-level alignment.

### Upgrade scopes included
- testing and CI scope
- canonical architecture scope
- runtime scope

### Exact deliverables
- CI workflow for canonical validation
- CI workflow for architecture drift checks
- deployment parity checklist
- patch-vs-runtime verification workflow
- runtime confirmation procedure

### Owners / module targets
- release owner
- runtime owner
- architecture owner

### Validation checks
- distinguish:
  - file merged
  - registry aligned
  - runtime deployed
  - live behavior confirmed
- canonical validation passes in CI
- drift checks fail loudly on mismatch

### Done criteria
- deployment claims require runtime proof
- CI can detect canonical/runtime divergence
- live verification procedure is documented and repeatable

### Acceptance evidence
- CI pipeline output
- parity checklist run
- live verification log

---

# 7. Execution matrix

| Phase | Primary modules/files | Main output | Blocks next phases if missing? |
|---|---|---|---|
| 0 | canonicals, root runtime, connector tree | baseline inventory | Yes |
| 1 | README + new docs | architecture-aligned docs | Yes |
| 2 | normalization modules | canonical runtime objects | Yes |
| 3 | `server.js` + extracted modules | authority-based decomposition | Partial |
| 4 | `http-generic-api/*` | connector API hardening | No |
| 5 | CPT preflight module | stable CPT logic | No |
| 6 | mutation and duplicate logic | deterministic governance | Yes |
| 7 | tests and validation scripts | regression protection | Yes |
| 8 | CI and deployment workflows | verified live alignment | Final gate |

---

# 8. Quantified success metrics
To make this a 9.5+ execution program, success must be measurable.

## Documentation metrics
- 100% of public architecture docs reference canonicals correctly
- 0 generic architecture sections remain in README without governed mapping

## Runtime metrics
- root runtime loses at least 5 major authority clusters to extracted modules
- connector modules expose only documented public APIs
- normalization layer covers policy, endpoint, mutation, and exemption semantics

## Governance metrics
- duplicate/exemption logic produces deterministic outcomes for:
  - general governed sheets
  - `Execution Log Unified`
- unsupported custom policy literals no longer directly drive enforcement

## Test metrics
- CPT preflight has dedicated assertions
- connector dispatch and API surface have dedicated assertions
- duplicate-preflight exemption path has dedicated assertions
- canonical validation checks are automated

## Release metrics
- file-level validation, runtime validation, and deployment validation are separate and explicit
- live parity verification exists before upgrade is called complete

---

# 9. Risks, controls, and rollback posture

## Risk
Refactor alters governed behavior silently  
## Control
Behavior-preserving extraction first, cleanup second  
## Rollback
Preserve baseline snapshots and per-phase reversible commits

## Risk
Normalization layer becomes another ad hoc abstraction  
## Control
Use explicit canonical object contracts and documented allowed fields  
## Rollback
Fallback to prior literal logic only behind controlled compatibility switches

## Risk
Connector cleanup breaks hidden callers  
## Control
Run export-to-caller matrix before privatization  
## Rollback
Restore export temporarily with deprecation note if needed

## Risk
Mutation hardening blocks legitimate runtime evidence  
## Control
Separate general append rules from sink-specific exemptions  
## Rollback
Revert exemption logic to last known stable centralized path

## Risk
Docs get updated but runtime does not  
## Control
Require doc/runtime alignment check in phase acceptance  
## Rollback
Mark documentation phase partial until runtime parity is confirmed

---

# 10. Definition of done — program level
The upgrade is complete only when all of the following are true:

- canonicals remain authoritative and aligned with runtime behavior
- README and AI-agent docs match the actual governed architecture
- normalized canonical state exists between registry/sheet input and backend enforcement
- root runtime is materially decomposed by authority boundary
- connectors expose minimal explicit public APIs
- CPT preflight logic is modular, deterministic, and tested
- duplicate/exemption handling is centralized and reliable
- tests protect major governed execution paths
- CI detects canonical/runtime/deployment drift
- live verification confirms the deployed runtime matches the upgraded design

---

# 11. Immediate implementation start pack
To begin execution immediately, do these first:

1. finalize baseline inventory
2. rewrite README
3. add `canonical_validation_checklist.md`
4. define normalization object contracts
5. audit `http-generic-api/github.js` exports vs callers
6. extract CPT preflight helpers
7. add first regression assertions
8. document mutation and sink exemption handling

---

# 12. Expected final rating after implementation
If this board is executed faithfully, the project upgrade outcome should target:

- **Architecture plan quality:** 9.5+/10
- **Documentation alignment:** 9.5+/10
- **Runtime coherence:** 9+/10
- **Governed execution reliability:** 9+/10
- **Connector module quality:** 9+/10
- **Upgrade traceability and proof:** 9.5+/10

The limiting factor after this plan will not be planning quality.  
It will be implementation discipline and validation follow-through.
