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
