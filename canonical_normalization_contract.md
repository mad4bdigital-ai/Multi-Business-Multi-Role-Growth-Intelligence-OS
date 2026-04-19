# Canonical Normalization Contract
**Purpose:** Define the target normalization layer that converts free-form runtime inputs into canonical governed objects before execution, mutation, or sink writeback.

## 1. Why this layer exists

The upgrade plan requires runtime enforcement to consume canonical normalized objects rather than ad hoc literals, route-local aliases, or raw sheet values.

This layer is intended to normalize:
- user-facing intent labels
- raw request payload fields
- sheet literals
- registry variants
- policy aliases
- legacy names

into deterministic governed runtime objects.

## 2. Normalization rule

No downstream runtime path should need to reason directly about:
- arbitrary string aliases
- raw sheet booleans
- unclassified mutation intent
- sink-specific wording embedded in route logic
- transport compatibility inferred independently in multiple places

Downstream runtime modules should consume normalized objects with explicit fields and governed classifications.

## 3. Target normalized object families

The first normalization layer should produce the following object families.

### A. `NormalizedExecutionIntent`

Purpose:
- represent the normalized execution request after request-shape cleanup and intent-level classification

Minimum target fields:
- `intent_family`
- `execution_class`
- `route_selection_mode`
- `workflow_selection_mode`
- `addition_intake_required`
- `patch_parity_verification_required`
- `brand_onboarding_required`
- `transport_mode_requested`
- `user_trigger_required`
- `execution_trace_id`

Examples of normalized `intent_family`:
- `http_execution`
- `site_migration`
- `governed_addition`
- `patch_parity_verification`
- `brand_onboarding`
- `governed_asset_intake`

### B. `NormalizedPolicyState`

Purpose:
- convert sheet policy literals and aliases into canonical boolean and enum state

Minimum target fields:
- `policy_group`
- `policy_key`
- `normalized_key`
- `enabled`
- `mode`
- `enum_value`
- `raw_value`
- `source_surface`
- `source_row_context`

Normalization requirements:
- `TRUE` and `FALSE` literals should not leak past this layer
- alias keys should map to canonical keys
- policy modes should normalize into explicit enums instead of route-local string checks

### C. `NormalizedEndpointIdentity`

Purpose:
- resolve and normalize action/endpoint identity before transport execution

Minimum target fields:
- `parent_action_key`
- `endpoint_key`
- `normalized_action_key`
- `normalized_endpoint_key`
- `provider_domain_mode`
- `resolved_auth_mode`
- `request_schema_alignment_required`
- `transport_compatible`
- `native_only_required`
- `connector_family`

Normalization requirements:
- aliases and legacy endpoint names collapse into one canonical endpoint identity
- auth handling resolves into governed runtime modes only
- transport compatibility is computed once and reused

### D. `NormalizedRouteWorkflowState`

Purpose:
- normalize route and workflow readiness state so runtime does not improvise route-local status logic

Minimum target fields:
- `route_id`
- `workflow_id`
- `route_status`
- `workflow_status`
- `selection_basis`
- `overlap_status`
- `chain_required`
- `promotion_blocked`
- `validation_required`

### E. `NormalizedSurfaceClassification`

Purpose:
- classify target surfaces for reads, writes, validation, and authority rules

Minimum target fields:
- `surface_id`
- `surface_name`
- `surface_family`
- `sheet_role`
- `authority_level`
- `binding_mode`
- `required_for_execution`
- `candidate_surface`
- `sink_surface`

Suggested `surface_family` values:
- `registry`
- `validation`
- `sink`
- `brand_core`
- `runtime_inventory`
- `connector_support`

### F. `NormalizedMutationIntent`

Purpose:
- make mutation behavior deterministic before duplicate checks and write planning

Minimum target fields:
- `mutation_class`
- `target_surface_family`
- `authority_mode`
- `candidate_only`
- `duplicate_check_required`
- `equivalence_check_required`
- `readback_required`
- `evidence_required`
- `sink_exemption_class`

Suggested `mutation_class` values:
- `append`
- `update`
- `rename`
- `merge`
- `candidate_write`
- `validation_write`
- `trace_write`
- `derived_artifact_write`

Suggested `authority_mode` values:
- `active_authority`
- `candidate_authority`
- `trace_only`
- `derived_only`

### G. `NormalizedExecutionResult`

Purpose:
- give sink and writeback layers a canonical result contract

Minimum target fields:
- `execution_status`
- `result_class`
- `degraded`
- `blocked`
- `output_summary`
- `error_code`
- `http_status`
- `async_mode`
- `oversized`
- `authoritative_evidence_class`

### H. `NormalizedSinkWriteContract`

Purpose:
- standardize what a governed sink write expects before row shaping

Minimum target fields:
- `sink_name`
- `sink_surface_id`
- `write_contract_status`
- `raw_writeback_required`
- `formula_protection_required`
- `header_validation_required`
- `exemption_class`
- `row_object`

## 4. Normalization domains to implement first

Per the upgrade plan, the first domains to normalize are:

1. policy state
2. endpoint keys and aliases
3. route/workflow selection state
4. surface classifications
5. mutation modes
6. execution classifications
7. sink exemptions

## 5. Implementation shape

The preferred implementation shape is a dedicated normalization boundary under `http-generic-api`, rather than new scattered helpers.

Recommended initial modules:
- `normalization/policy.js`
- `normalization/endpoint.js`
- `normalization/routeWorkflow.js`
- `normalization/surface.js`
- `normalization/mutation.js`
- `normalization/executionResult.js`
- `normalization/index.js`

If the repo is not ready for a subfolder yet, an intermediate module such as `http-generic-api/normalization.js` is acceptable as a staging boundary.

## 6. Current raw-to-canonical pressure points

Based on current runtime review, the first pressure points are:
- literal policy checks in `server.js`, `auth.js`, and `execution.js`
- auth-mode compatibility logic in transport preparation
- route and workflow readiness wording embedded in route handlers
- duplicate and exemption semantics implied by sink-specific logic
- mutation semantics not yet normalized into explicit shared classes

## 7. Non-goals for first normalization pass

The first pass should not attempt to:
- redesign canonicals
- change business behavior intentionally
- replatform all modules at once
- replace registry truth with local constants

The first pass should preserve behavior while converting ambiguous literals into explicit governed state.

## 8. Success criteria

The normalization layer is succeeding when:
- runtime callers consume normalized objects rather than raw literals
- auth and transport compatibility are determined once
- mutation and sink handling are easier to centralize
- route handlers stop embedding policy wording logic directly
- downstream modules can validate contracts more directly

## 9. Immediate first extraction targets

The best first extraction targets for normalization are:

1. policy state and required-policy presence handling
2. endpoint/action/auth identity resolution
3. mutation-class and sink-exemption classification
4. execution-result classification feeding governed sink rows

## 10. Relationship to the current documentation package

This document complements:
- [`README.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/README.md>)
- [`canonical_validation_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonical_validation_checklist.md>)
- [`runtime_boundary_map.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_boundary_map.md>)
- [`governed_mutation_playbook.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/governed_mutation_playbook.md>)
- [`project_upgrade_preparation_baseline.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/project_upgrade_preparation_baseline.md>)

It should be used as the Phase 2 bridge between documentation alignment and runtime decomposition.
