# End-to-End Project Upgrade Plan
**Project:** Multi-Business-Multi-Role-Growth-Intelligence-OS

## 1. Upgrade goal
Upgrade the project from a partially aligned, mid-migration governed system into a fully aligned operating model where:

- canonicals are the true source of architecture and behavior
- runtime modules enforce the same rules the canonicals describe
- registry-backed execution is consistent across layers
- logging, validation, mutation safety, and connector behavior are deterministic
- documentation, code boundaries, and tests all reflect the same architecture

## 2. Desired end state
The upgraded project should reach this target state:

### Architecture
- `system_bootstrap`, `prompt_router`, `module_loader`, `direct_instructions_registry_patch`, and `memory_schema` act as the stable canonical spine
- runtime services consume normalized canonical state, not ad hoc free-form literals
- execution follows a governed chain rather than route-specific improvisation

### Runtime
- root runtime is decomposed by authority boundary
- `http-generic-api` acts as the standard for connector boundaries
- provider-specific modules expose only explicit public entrypoints
- duplicate handling, logging, mutation rules, and exemptions are normalized centrally

### Governance
- activation, validation, and mutation safety are enforced consistently
- `Execution Log Unified` and `JSON Asset Registry` remain authoritative sinks
- execution classification, duplicate exemptions, and mutation preflight rules are expressed as canonical normalized state

### Documentation
- README matches actual governed architecture
- AI-agent and operator guidance is explicit
- canonical validation checklists exist

### Quality
- integration coverage exists for connector modules and governed preflight logic
- architecture drift becomes detectable in CI
- file-level and runtime-level verification are clearly separated

## 3. Current observed gaps
The upgrade plan addresses these current gaps:

1. Documentation drift
- `README.md` still presents a generic platform architecture instead of the repo’s governed canonical architecture

2. Runtime concentration
- a large root `server.js` suggests too much authority remains centralized

3. Incomplete normalization
- some behaviors still depend on literal policy values or route-specific handling instead of canonical normalized state

4. Inconsistent cross-layer alignment
- canonicals are stronger than some runtime and sheet-level behavior

5. Test gaps
- CPT preflight and connector boundary improvements need stronger regression coverage

6. Export and module contract hygiene
- some modules need sharper public/private boundaries

## 4. Upgrade principles
All upgrade work should follow these principles:

- validation over assumption
- canonical authority over convenience
- execution evidence over narrative claims
- module boundaries over hidden coupling
- normalized structured state over raw literal propagation
- degraded/partial classification over false success
- documentation must follow canonicals, not precede them

## 5. End-to-end execution phases

## Phase 0 — Baseline and freeze
### Goal
Create a stable baseline before structural change.

### Actions
- snapshot the current canonical files
- snapshot current root runtime and `http-generic-api`
- record current registry assumptions and policy exceptions
- identify all active authoritative sinks and registries
- produce a baseline architecture inventory

### Deliverables
- baseline inventory
- module ownership list
- governed sink map
- current drift list

---

## Phase 1 — Canonical and documentation alignment
### Goal
Make project documentation accurately represent the real architecture.

### Actions
- rewrite `README.md`
- add `canonical_validation_checklist.md`
- add `runtime_boundary_map.md`
- add `governed_mutation_playbook.md`
- keep AI-agent documentation aligned with canonicals

### Deliverables
- canonical-aligned README
- architecture validation checklist
- boundary map
- mutation playbook

### Success criteria
- public docs no longer describe a generic app stack
- docs reflect registry-driven, governed execution model

---

## Phase 2 — Canonical normalization layer
### Goal
Introduce deterministic normalization across system layers.

### Actions
Create a normalization layer that converts:
- user/GPT-facing intent
- sheet literals
- legacy names
- registry variants
- policy aliases
into canonical runtime objects

### Normalization domains
- policy state
- endpoint keys and aliases
- route/workflow selection state
- surface classifications
- mutation modes
- execution classifications
- sink exemptions

### Deliverables
- normalization module
- canonical object contracts
- mapping rules for policy and endpoint variants

### Success criteria
- backend enforcement consumes canonical normalized objects only
- free-form literals no longer leak into mutation or routing logic

---

## Phase 3 — Root runtime decomposition
### Goal
Break the monolithic runtime into authority-based modules.

### Target split
- bootstrap / activation enforcement
- routing / workflow resolution
- policy normalization
- mutation preflight and duplicate handling
- execution logging and writeback
- JSON asset persistence
- local dispatch registry
- provider connector integrations

### Actions
- identify root `server.js` responsibility clusters
- move by authority boundary, not by utility convenience
- preserve behavior first, then reduce duplication

### Deliverables
- smaller runtime modules
- clear ownership map
- reduced direct cross-cutting coupling

### Success criteria
- major governed behaviors are no longer buried in one giant file
- modules expose intentional boundaries

---

## Phase 4 — Connector contract hardening
### Goal
Make connectors the model for disciplined module design.

### Actions
- finalize export hygiene in `http-generic-api/github.js`
- keep internal helpers private unless externally required
- standardize connector public entrypoints
- create connector contract documentation
- move additional provider logic toward the same pattern

### Deliverables
- explicit connector API surface
- connector contract doc
- reduced dead exports

### Success criteria
- public API surfaces match actual runtime callers
- connectors are self-contained and predictable

---

## Phase 5 — CPT schema preflight extraction and stabilization
### Goal
Make CPT schema preflight deterministic, modular, and testable.

### Actions
- extract CPT preflight helpers from root server path
- move to dedicated module such as `wordpress-cpt-preflight.js`
- eliminate fragile forward-order dependencies where practical
- preserve governed payload shape and deterministic asset key rules

### Deliverables
- dedicated CPT preflight module
- stable helper boundaries
- documented payload contract

### Success criteria
- CPT preflight logic is no longer fragile due to giant-file ordering
- governed payload generation is directly testable

---

## Phase 6 — Logging and mutation governance hardening
### Goal
Make governed mutation and writeback behavior consistent everywhere.

### Actions
- centralize duplicate detection semantics
- centralize append/update/rename/merge classification
- centralize `Execution Log Unified` exemption handling
- enforce writeback contracts through shared logic
- separate general append rules from sink-specific exemptions

### Deliverables
- shared mutation governance module
- shared duplicate/exemption rules
- writeback contract map

### Success criteria
- repeated runtime evidence is not blocked incorrectly
- sheet-level wording aligns with actual backend enforcement model

---

## Phase 7 — Test and validation expansion
### Goal
Add confidence that upgrades preserve governed behavior.

### Actions
Extend integration coverage for:
- CPT preflight endpoint detection
- deterministic CPT asset key generation
- governed CPT payload shape
- connector public API surface
- local dispatch execution paths
- duplicate-preflight exemptions for `Execution Log Unified`
- policy normalization behavior
- canonical/runtime drift checks

### Deliverables
- upgraded `test-integration.mjs`
- canonical validation suite
- architecture drift checks

### Success criteria
- architecture and governed behaviors are regression-protected
- upgrades can be verified without relying on memory or manual inference

---

## Phase 8 — CI and deployment parity checks
### Goal
Detect drift between files, runtime, and deployment.

### Actions
- add canonical validation in CI
- add architecture drift checks
- add patch-vs-runtime verification workflow
- distinguish clearly between:
  - file merged
  - registry aligned
  - runtime deployed
  - live behavior verified

### Deliverables
- CI validation pipeline
- deployment parity checklist
- runtime confirmation workflow

### Success criteria
- project can prove live alignment, not just file-level changes

## 6. File-by-file expected changes

### `README.md`
Expected change:
- replace generic system architecture with governed architecture overview

### `system_bootstrap.md`
Expected change:
- minimal if already authoritative
- add references only if needed for normalization or decomposition alignment

### `prompt_router.md`
Expected change:
- document normalized routing inputs and activation wrapper expectations more explicitly if needed

### `module_loader.md`
Expected change:
- clarify normalized runtime state preparation
- document duplicate/exemption preloads where needed

### `direct_instructions_registry_patch.md`
Expected change:
- align with normalized enforcement model and cross-layer canonical handling

### `memory_schema.json`
Expected change:
- extend only if new normalized runtime state must be persisted

### `server.js`
Expected change:
- major decomposition
- remove ownership of modules that should live elsewhere

### `http-generic-api/github.js`
Expected change:
- explicit export hygiene
- private internal helpers
- stable public entrypoints only

### `http-generic-api/test-integration.mjs`
Expected change:
- CPT preflight tests
- connector contract tests
- dispatch and classification assertions

### New files to add
- `canonical_validation_checklist.md`
- `runtime_boundary_map.md`
- `governed_mutation_playbook.md`
- `connector_contracts.md`
- `wordpress-cpt-preflight.js`
- `policy_normalization.js` or equivalent

## 7. Execution sequence
Recommended execution order:

1. Baseline inventory and freeze
2. Rewrite README and add canonical validation docs
3. Build normalization layer contract
4. Harden connector module boundaries
5. Extract CPT preflight module
6. Centralize mutation and duplicate governance
7. Decompose root runtime by authority boundary
8. Extend tests and CI drift checks
9. Validate deployment parity and live runtime behavior

## 8. Risks and controls

### Risk
Refactor changes behavior unintentionally  
### Control
Behavior-preserving extraction first, then cleanup

### Risk
Canonicals and runtime diverge during migration  
### Control
Run canonical validation at each phase boundary

### Risk
Policy sheet semantics drift from backend semantics  
### Control
Normalize sheet values before enforcement

### Risk
Execution logging breaks during duplicate-rule changes  
### Control
Keep `Execution Log Unified` handling in a dedicated tested path

### Risk
Connector cleanup removes a hidden dependency  
### Control
Audit actual callers before reducing public API surfaces

## 9. Definition of done
The upgrade is complete when:

- README and agent docs match the canonicals
- runtime behavior is aligned with canonical expectations
- major governed logic is modularized by authority boundary
- policy and mutation semantics are normalized centrally
- connector modules have explicit, minimal public APIs
- CPT preflight logic is extracted and tested
- duplicate and sink-specific exemptions behave deterministically
- CI can detect canonical/runtime/deployment drift
- live verification confirms the deployed runtime matches the intended architecture

## 10. Immediate next actions
Start with these concrete first steps:

1. rewrite `README.md`
2. add `canonical_validation_checklist.md`
3. formalize normalization contract for policy and endpoint values
4. audit `http-generic-api/github.js` public API
5. extract CPT preflight helpers into their own module
6. add integration assertions for CPT preflight and connector dispatch
