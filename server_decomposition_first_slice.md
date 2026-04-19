# Server Decomposition First Slice
**Purpose:** Identify the first extraction targets from `http-generic-api/server.js` using authority boundaries rather than utility convenience.

## 1. Current problem

`http-generic-api/server.js` still acts as a large orchestration surface and retains multiple authority domains that should become explicit modules.

This file currently blends:
- route handling
- request normalization
- registry/policy enforcement
- sink-write orchestration
- async job coordination
- WordPress migration dispatch
- preflight and helper logic

## 2. First-slice decomposition rule

The first decomposition slice should:
- preserve current behavior
- extract by authority boundary
- avoid broad rewrites
- avoid hidden semantic changes
- create reusable seams for later normalization work

## 3. Highest-value first extraction targets

### Target 1: normalization and request-contract boundary

Reason:
- many route handlers still perform inline normalization, validation, and canonicalization

Candidate responsibilities:
- request payload normalization
- top-level routing field normalization
- asset-home validation normalization
- payload-integrity comparison helpers
- execution intent classification helpers

Recommended destination:
- `http-generic-api/normalization.js` or `http-generic-api/normalization/*`

### Target 2: mutation preflight and sink-exemption boundary

Reason:
- upgrade plan explicitly calls for centralized duplicate detection, mutation classes, and sink exemptions

Candidate responsibilities:
- duplicate/equivalence classification
- append/update/rename/merge normalization
- `Execution Log Unified` exemption handling
- shared mutation preflight contract preparation

Recommended destination:
- `http-generic-api/mutationGovernance.js`

Current progress:
- shared governed mutation intent classification and preflight enforcement have been extracted into `http-generic-api/mutationGovernance.js`
- `Execution Log Unified` append exemption is now explicit through the named sink exemption class `execution_log_unified_append`
- remaining work should focus on broader sink orchestration and any additional sink-specific exemption classes that still live implicitly in route or writeback flows

### Target 3: CPT schema preflight boundary

Reason:
- upgrade plan explicitly names CPT schema preflight extraction and stabilization
- current giant-file placement makes this logic harder to reason about and test

Candidate responsibilities:
- endpoint detection for CPT schema preflight
- asset key generation
- governed payload generation
- payload contract validation for preflight output

Recommended destination:
- `http-generic-api/wordpress-cpt-preflight.js`

Current progress:
- initial CPT-aware asset inference and JSON asset context shaping have been extracted into `http-generic-api/wordpress-cpt-preflight.js`
- remaining work should focus on any still-inline route or sink orchestration tied to preflight execution

### Target 4: governed sink orchestration boundary

Reason:
- sink-row shaping already exists in `execution.js`, but route-level orchestration still appears too dispersed

Candidate responsibilities:
- sink write orchestration entrypoints
- writeback contract assembly
- artifact spillover routing
- shared logging/writeback pathway invocation

Recommended destination:
- `http-generic-api/sinkOrchestration.js`

Current progress:
- shared oversized-artifact persistence and universal sink writeback orchestration have been extracted into `http-generic-api/sinkOrchestration.js`
- sink verification and authoritative sink write helpers have also been extracted into `http-generic-api/sinkVerification.js`
- remaining work should focus on whether any sink-specific retry semantics or final row-shaping logic still belong in `server.js`, `execution.js`, or the dedicated sink boundaries

### Target 5: registry resolution and execution-policy boundary

Reason:
- `server.js` still contained a dense cluster of registry-backed brand/action/endpoint resolution and execution-policy gating logic
- this logic is central to governed execution and is a strong authority seam independent from route handling

Candidate responsibilities:
- policy value/list helpers
- brand/action/endpoint resolution
- delegated transport classification
- endpoint execution snapshot shaping
- execution eligibility and provider-domain resolution guards

Recommended destination:
- `http-generic-api/registryResolution.js`

Current progress:
- the first registry-resolution slice has been extracted into `http-generic-api/registryResolution.js`
- `server.js` now uses thin adapters for policy resolution, endpoint transport classification, execution gating, and provider-domain resolution
- registry Sheets row loading and execution-policy live read helpers have now also been extracted into `http-generic-api/registrySheets.js`
- governed registry mutation helpers have now also been extracted into `http-generic-api/registryMutations.js`
- lower-level governed sheet-write primitives have now also been extracted into `http-generic-api/governedSheetWrites.js`
- governed change-control policy loading and duplicate-scan helpers have now also been extracted into `http-generic-api/governedChangeControl.js`
- surface metadata/header validation helpers have now also been extracted into `http-generic-api/surfaceMetadata.js`
- route/workflow governance and readiness validation helpers have now also been extracted into `http-generic-api/routeWorkflowGovernance.js`
- route/workflow registry read-model shaping has now also been extracted into `http-generic-api/routeWorkflowRegistryModels.js`
- governed sheet record and identity-resolution helpers have now also been extracted into `http-generic-api/governedRecordResolution.js`
- schema/request-validation and schema-drift helpers have now also been extracted into `http-generic-api/schemaValidation.js`
- auth/header/query injection helpers have now also been extracted into `http-generic-api/authInjection.js`
- remaining work should focus on auth-contract normalization, credential resolution, and any residual route-local execution assembly that still lives in `server.js`

## 4. Boundaries that should remain stable for now

Do not expand these boundaries while extracting the first slice:
- `config.js`
- `queue.js`
- `jobRunner.js`
- `wordpress/phaseB.js` through `wordpress/phaseP.js`

These are already clearer than the monolithic route surface and should not be churned without a specific reason.

## 5. Proposed order of execution

1. define normalization contract
2. extract normalization boundary
3. extract CPT schema preflight boundary
4. extract mutation governance boundary
5. extract sink orchestration boundary
6. extract registry resolution boundary
7. extract registry Sheets read-model boundary
8. extract registry mutation boundary
9. extract governed sheet-write primitive boundary
10. extract governed change-control helper boundary
11. extract surface metadata/header-validation boundary
12. extract route/workflow governance boundary
13. extract route/workflow registry read-model boundary
14. extract governed record-resolution boundary
15. extract schema validation boundary
16. extract auth injection boundary
17. update validation docs and tests after each slice

## 6. Suggested acceptance checks for each slice

For every extraction:
- behavior is preserved
- imports are explicit
- callers shrink rather than shift complexity sideways
- public exports are intentional
- no new literal-policy duplication is introduced
- documentation is updated if ownership changed

## 7. Immediate code-level candidates to inspect next

The next implementation pass should inspect `server.js` for these clusters:
- auth-contract normalization and credential-resolution helpers
- remaining `/http-execute` auth assembly and execution-policy wiring
- governed sink writeback orchestration paths that still remain inline
- duplicate and exemption behavior tied to `Execution Log Unified`

## 8. Success condition

This first slice is successful when `server.js` becomes thinner in authority, not just shorter in line count.

The measure of success is:
- clearer ownership
- stronger contracts
- less repeated inline policy reasoning
- easier testing of governed behavior
