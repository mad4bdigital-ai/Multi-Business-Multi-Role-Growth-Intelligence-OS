import { BRAND_CORE_REGISTRY_SHEET } from "./config.js";

export function normalizeExecutionPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const query =
    safePayload.query && typeof safePayload.query === "object"
      ? safePayload.query
      : safePayload.params?.query &&
        typeof safePayload.params.query === "object"
      ? safePayload.params.query
      : {};

  const body = Object.prototype.hasOwnProperty.call(safePayload, "body")
    ? safePayload.body
    : undefined;

  const routingFields = normalizeTopLevelRoutingFields(safePayload);

  return {
    ...safePayload,
    ...routingFields,
    query,
    body
  };
}

export function normalizeTopLevelRoutingFields(payload = {}) {
  return {
    target_key: payload.target_key,
    brand: payload.brand,
    brand_domain: payload.brand_domain,
    provider_domain: payload.provider_domain,
    parent_action_key: payload.parent_action_key,
    endpoint_key: payload.endpoint_key,
    method: payload.method,
    path: payload.path,
    force_refresh: payload.force_refresh
  };
}

export function validatePayloadIntegrity(originalPayload = {}, normalizedPayload = {}) {
  const trackedFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path"
  ];

  const mismatches = [];

  for (const field of trackedFields) {
    const originalValue = originalPayload[field];
    const normalizedValue = normalizedPayload[field];

    const originalText = originalValue === undefined ? "" : String(originalValue);
    const normalizedText = normalizedValue === undefined ? "" : String(normalizedValue);

    if (originalText !== normalizedText) {
      mismatches.push({
        field,
        original: originalValue ?? "",
        normalized: normalizedValue ?? ""
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

export function validateTopLevelRoutingFields(payload = {}, policies = [], deps = {}) {
  const { policyValue } = deps;
  if (typeof policyValue !== "function") {
    throw new Error("validateTopLevelRoutingFields requires deps.policyValue");
  }

  const requireTopLevelSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Placeholder Resolution Sources Must Be Top-Level",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowNestedSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Nested Placeholder Resolution Sources Allowed",
      "TRUE"
    )
  ).trim().toUpperCase() === "TRUE";

  const errors = [];

  const topLevelHasSource =
    !!String(payload.target_key || "").trim() ||
    !!String(payload.brand || "").trim() ||
    !!String(payload.brand_domain || "").trim();

  const nestedBody = payload.body && typeof payload.body === "object" ? payload.body : {};
  const isDelegatedWrapper = isDelegatedHttpExecuteWrapper(payload);

  const nestedHasSource =
    !!String(nestedBody.target_key || "").trim() ||
    !!String(nestedBody.brand || "").trim() ||
    !!String(nestedBody.brand_domain || "").trim();

  if (requireTopLevelSources && payload.provider_domain === "target_resolved" && !topLevelHasSource) {
    errors.push("top-level target_key, brand, or brand_domain is required when provider_domain is target_resolved");
  }

  if (!allowNestedSources && nestedHasSource && !isDelegatedWrapper) {
    errors.push("target_key, brand, and brand_domain must be top-level fields; nested body.* routing fields are not allowed");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string");
  }

  if (payload.method !== undefined && typeof payload.method !== "string") {
    errors.push("method must be a string");
  }

  if (payload.path !== undefined && typeof payload.path !== "string") {
    errors.push("path must be a string");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateAssetHomePayloadRules(payload = {}, deps = {}) {
  const { normalizeAssetType, classifyAssetHome } = deps;
  if (typeof normalizeAssetType !== "function") {
    throw new Error("validateAssetHomePayloadRules requires deps.normalizeAssetType");
  }
  if (typeof classifyAssetHome !== "function") {
    throw new Error("validateAssetHomePayloadRules requires deps.classifyAssetHome");
  }

  const assetType = normalizeAssetType(payload.asset_type);
  if (!assetType) {
    return { ok: true, errors: [] };
  }

  const classification = classifyAssetHome({
    asset_type: assetType,
    endpoint_key: payload.endpoint_key,
    source_asset_ref: payload.source_asset_ref,
    asset_key: payload.asset_key
  });

  if (
    classification.authoritative_home === "brand_core_registry" &&
    String(payload.force_json_asset_write || "").trim().toUpperCase() === "TRUE"
  ) {
    return {
      ok: false,
      errors: [
        `asset_type=${assetType} must not force JSON Asset Registry write; authoritative home is ${BRAND_CORE_REGISTRY_SHEET}`
      ]
    };
  }

  return { ok: true, errors: [] };
}

export function isHttpGenericTransportEndpointKey(endpointKey = "") {
  return [
    "http_get",
    "http_post",
    "http_put",
    "http_patch",
    "http_delete"
  ].includes(String(endpointKey || "").trim());
}

export function isDelegatedHttpExecuteWrapper(payload = {}) {
  return (
    String(payload.parent_action_key || "").trim() === "http_generic_api" &&
    isHttpGenericTransportEndpointKey(payload.endpoint_key) &&
    String(payload.path || "").trim() === "/http-execute"
  );
}

export function promoteDelegatedExecutionPayload(payload = {}) {
  if (!isDelegatedHttpExecuteWrapper(payload)) {
    return payload;
  }

  const nested = payload.body && typeof payload.body === "object" ? payload.body : {};

  const nestedHeaders =
    nested.headers && typeof nested.headers === "object"
      ? nested.headers
      : undefined;

  const nestedQuery =
    nested.query && typeof nested.query === "object"
      ? nested.query
      : undefined;

  const nestedPathParams =
    nested.path_params && typeof nested.path_params === "object"
      ? nested.path_params
      : undefined;

  return {
    ...payload,
    target_key: payload.target_key || nested.target_key,
    brand: payload.brand || nested.brand,
    brand_domain: payload.brand_domain || nested.brand_domain,
    provider_domain: nested.provider_domain || payload.provider_domain,
    parent_action_key: nested.parent_action_key || payload.parent_action_key,
    endpoint_key: nested.endpoint_key || payload.endpoint_key,
    method: nested.method || payload.method,
    path: nested.path || payload.path,
    force_refresh: nested.force_refresh ?? payload.force_refresh,
    timeout_seconds: nested.timeout_seconds ?? payload.timeout_seconds,
    expect_json: nested.expect_json ?? payload.expect_json,
    readback: nested.readback ?? payload.readback,
    headers: nestedHeaders || payload.headers,
    query: nestedQuery || payload.query,
    path_params: nestedPathParams || payload.path_params,
    body: Object.prototype.hasOwnProperty.call(nested, "body")
      ? nested.body
      : payload.body
  };
}

export function isHostingerAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "hostinger_api";
}

export function isSiteTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.endsWith("_wp") ||
    v.startsWith("site_") ||
    v.startsWith("brand_") ||
    v.includes("_wordpress")
  );
}

export function isHostingAccountTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.startsWith("hostinger_") ||
    v.includes("_shared_manager_") ||
    v.includes("_hosting_account_") ||
    v.includes("_cloud_plan_") ||
    v.includes("_account_")
  );
}

export function assertHostingerTargetTier(payload = {}) {
  const parentActionKey = String(payload.parent_action_key || "").trim();
  const endpointKey = String(payload.endpoint_key || "").trim();
  const targetKey = String(payload.target_key || "").trim();

  if (!isHostingerAction(parentActionKey)) {
    return { ok: true };
  }

  if (!targetKey) {
    const err = new Error(
      "Hostinger execution requires an authoritative hosting-account target_key."
    );
    err.code = "hostinger_target_key_missing";
    err.status = 400;
    throw err;
  }

  if (isSiteTargetKey(targetKey) && !isHostingAccountTargetKey(targetKey)) {
    const err = new Error(
      `Hostinger endpoint ${endpointKey} must resolve through a hosting-account target_key, not a WordPress/site target_key (${targetKey}).`
    );
    err.code = "hostinger_target_tier_mismatch";
    err.status = 400;
    throw err;
  }

  return { ok: true };
}

/**
 * Canonical Normalization Contract - Staging Boundary
 * 
 * Converts free-form runtime inputs (sheet literals, aliases, raw objects)
 * into deterministic canonical governed objects before execution, mutation, 
 * or sink writeback.
 */

/**
 * A. NormalizedExecutionIntent
 * Represents the normalized execution request after request-shape cleanup and intent-level classification.
 */
export function normalizeExecutionIntent(raw = {}) {
  return {
    intent_family: raw.intent_family || '',
    execution_class: raw.execution_class || '',
    route_selection_mode: raw.route_selection_mode || '',
    workflow_selection_mode: raw.workflow_selection_mode || '',
    addition_intake_required: Boolean(raw.addition_intake_required),
    patch_parity_verification_required: Boolean(raw.patch_parity_verification_required),
    brand_onboarding_required: Boolean(raw.brand_onboarding_required),
    transport_mode_requested: raw.transport_mode_requested || '',
    user_trigger_required: Boolean(raw.user_trigger_required),
    execution_trace_id: raw.execution_trace_id || ''
  };
}

/**
 * B. NormalizedPolicyState
 * Converts sheet policy literals and aliases into canonical boolean and enum state.
 */
export function normalizePolicyState(raw = {}) {
  const rawEnabled = raw.enabled ?? raw.raw_value;
  const isEnabled = rawEnabled === true || String(rawEnabled).trim().toUpperCase() === 'TRUE';
  
  return {
    policy_group: raw.policy_group || '',
    policy_key: raw.policy_key || '',
    normalized_key: String(raw.policy_key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    enabled: isEnabled,
    mode: raw.mode || '',
    enum_value: raw.enum_value || null,
    raw_value: raw.raw_value ?? null,
    source_surface: raw.source_surface || '',
    source_row_context: raw.source_row_context || null
  };
}

/**
 * C. NormalizedEndpointIdentity
 * Resolves and normalizes action/endpoint identity before transport execution.
 */
export function normalizeEndpointIdentity(raw = {}) {
  return {
    parent_action_key: raw.parent_action_key || '',
    endpoint_key: raw.endpoint_key || '',
    normalized_action_key: String(raw.parent_action_key || '').trim().toLowerCase(),
    normalized_endpoint_key: String(raw.endpoint_key || '').trim().toLowerCase(),
    provider_domain_mode: raw.provider_domain_mode || '',
    resolved_auth_mode: raw.resolved_auth_mode || '',
    request_schema_alignment_required: Boolean(raw.request_schema_alignment_required),
    transport_compatible: Boolean(raw.transport_compatible),
    native_only_required: Boolean(raw.native_only_required),
    connector_family: raw.connector_family || ''
  };
}

/**
 * D. NormalizedRouteWorkflowState
 * Normalizes route and workflow readiness state.
 */
export function normalizeRouteWorkflowState(raw = {}) {
  return {
    route_id: raw.route_id || '',
    workflow_id: raw.workflow_id || '',
    route_status: raw.route_status || '',
    workflow_status: raw.workflow_status || '',
    selection_basis: raw.selection_basis || '',
    overlap_status: raw.overlap_status || '',
    chain_required: Boolean(raw.chain_required),
    promotion_blocked: Boolean(raw.promotion_blocked),
    validation_required: Boolean(raw.validation_required)
  };
}

/**
 * E. NormalizedSurfaceClassification
 * Classifies target surfaces for reads, writes, validation, and authority rules.
 */
export function normalizeSurfaceClassification(raw = {}) {
  return {
    surface_id: raw.surface_id || '',
    surface_name: raw.surface_name || '',
    surface_family: raw.surface_family || '',
    sheet_role: raw.sheet_role || '',
    authority_level: raw.authority_level || '',
    binding_mode: raw.binding_mode || '',
    required_for_execution: Boolean(raw.required_for_execution),
    candidate_surface: Boolean(raw.candidate_surface),
    sink_surface: Boolean(raw.sink_surface)
  };
}

/**
 * F. NormalizedMutationIntent
 * Makes mutation behavior deterministic before duplicate checks and write planning.
 */
export function normalizeMutationIntent(raw = {}) {
  return {
    mutation_class: raw.mutation_class || '',
    target_surface_family: raw.target_surface_family || '',
    authority_mode: raw.authority_mode || '',
    candidate_only: Boolean(raw.candidate_only),
    duplicate_check_required: Boolean(raw.duplicate_check_required),
    equivalence_check_required: Boolean(raw.equivalence_check_required),
    readback_required: Boolean(raw.readback_required),
    evidence_required: Boolean(raw.evidence_required),
    sink_exemption_class: raw.sink_exemption_class || ''
  };
}

/**
 * G. NormalizedExecutionResult
 * Gives sink and writeback layers a canonical result contract.
 */
export function normalizeExecutionResult(raw = {}) {
  return {
    execution_status: raw.execution_status || '',
    result_class: raw.result_class || '',
    degraded: Boolean(raw.degraded),
    blocked: Boolean(raw.blocked),
    output_summary: raw.output_summary || '',
    error_code: raw.error_code || '',
    http_status: raw.http_status || null,
    async_mode: Boolean(raw.async_mode),
    oversized: Boolean(raw.oversized),
    authoritative_evidence_class: raw.authoritative_evidence_class || ''
  };
}

/**
 * H. NormalizedSinkWriteContract
 * Standardizes what a governed sink write expects before row shaping.
 */
export function normalizeSinkWriteContract(raw = {}) {
  return {
    sink_name: raw.sink_name || '',
    sink_surface_id: raw.sink_surface_id || '',
    write_contract_status: raw.write_contract_status || '',
    raw_writeback_required: Boolean(raw.raw_writeback_required),
    formula_protection_required: Boolean(raw.formula_protection_required),
    header_validation_required: Boolean(raw.header_validation_required),
    exemption_class: raw.exemption_class || '',
    row_object: raw.row_object || {}
  };
}
