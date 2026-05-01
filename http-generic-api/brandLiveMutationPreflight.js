const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function bool(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function normalize(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function getBodyObject(requestPayload = {}) {
  const body = requestPayload.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

export function isWordpressRuntimeEndpoint(parentActionKey = "", endpoint = {}) {
  return (
    normalize(parentActionKey) === "wordpress_api" ||
    normalize(endpoint.parent_action_key) === "wordpress_api" ||
    normalize(endpoint.route_target) === "wordpress_api"
  );
}

export function inferBrandMutationClass({ method = "", endpoint = {}, requestPayload = {} } = {}) {
  const normalizedMethod = normalize(method).toUpperCase();
  const endpointKey = lower(endpoint.endpoint_key);
  const path = lower(endpoint.endpoint_path_or_function || endpoint.path);
  const body = getBodyObject(requestPayload);
  const status = lower(body.status || body.post_status || requestPayload.status);

  if (!WRITE_METHODS.has(normalizedMethod)) return "brand_live_data_fetch";
  if (normalizedMethod === "DELETE" || endpointKey.includes("delete")) {
    return "brand_live_delete_or_destructive";
  }
  if (status === "publish" || status === "published") {
    return "brand_live_publish_status_change";
  }
  if (
    endpointKey.includes("update") ||
    endpointKey.includes("edit") ||
    normalizedMethod === "PUT" ||
    normalizedMethod === "PATCH" ||
    (normalizedMethod === "POST" && /\{[^}]+\}/.test(path))
  ) {
    return "brand_live_update_existing";
  }
  return "brand_draft_create_update";
}

export function isTaxonomyMutationEndpoint(endpoint = {}, requestPayload = {}) {
  const endpointKey = lower(endpoint.endpoint_key);
  const path = lower(endpoint.endpoint_path_or_function || endpoint.path);
  const body = getBodyObject(requestPayload);
  return (
    endpointKey.includes("taxonomy") ||
    endpointKey.includes("term") ||
    path.includes("/taxonomies") ||
    path.includes("/terms") ||
    Array.isArray(body.taxonomies) ||
    body.taxonomy_terms ||
    body.term_ids
  );
}

export function isWpmlMutationEndpoint(endpoint = {}, requestPayload = {}) {
  const endpointKey = lower(endpoint.endpoint_key);
  const path = lower(endpoint.endpoint_path_or_function || endpoint.path);
  const body = getBodyObject(requestPayload);
  return (
    endpointKey.includes("wpml") ||
    endpointKey.includes("translation") ||
    path.includes("wpml") ||
    path.includes("translation") ||
    bool(body.is_translation) ||
    normalize(body.language_code || body.lang || requestPayload.language_code)
  );
}

function hasOperatorApproval(requestPayload = {}) {
  const approval = requestPayload.mutation_approval || requestPayload.operator_approval || {};
  return (
    bool(requestPayload.operator_approved) ||
    bool(requestPayload.operator_approval_granted) ||
    bool(approval.approved) ||
    bool(approval.operator_approved)
  );
}

function getApprovalObject(requestPayload = {}) {
  return requestPayload.mutation_approval || requestPayload.operator_approval || {};
}

export function isExplicitDryRunPreflight(requestPayload = {}) {
  const approval = getApprovalObject(requestPayload);
  return (
    bool(requestPayload.dry_run) &&
    bool(requestPayload.preflight_only) &&
    bool(approval.dry_run ?? requestPayload.dry_run) &&
    bool(approval.preflight_only ?? requestPayload.preflight_only)
  );
}

function hasCompletedDryRunPreflight(requestPayload = {}) {
  const approval = getApprovalObject(requestPayload);
  return (
    bool(requestPayload.dry_run_preflight_completed) ||
    bool(requestPayload.approved_preflight_dry_run_validated) ||
    bool(approval.dry_run_preflight_completed) ||
    bool(approval.approved_preflight_dry_run_validated)
  );
}

function hasLiveExecutionApproval(requestPayload = {}) {
  const approval = getApprovalObject(requestPayload);
  return (
    bool(requestPayload.live_execution_approved) ||
    bool(requestPayload.execute_live) ||
    bool(approval.live_execution_approved) ||
    bool(approval.execute_live)
  );
}

function throwGate(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = 403;
  err.details = details;
  throw err;
}

export function enforceBrandLiveMutationPreflight(input = {}) {
  const {
    parent_action_key = "",
    endpoint = {},
    resolvedMethodPath = {},
    requestPayload = {},
    brand = null
  } = input;

  if (!isWordpressRuntimeEndpoint(parent_action_key, endpoint)) {
    return {
      enforced: false,
      reason: "not_wordpress_runtime_endpoint"
    };
  }

  const method = normalize(resolvedMethodPath.method || requestPayload.method || endpoint.method).toUpperCase();
  const mutationClass = inferBrandMutationClass({ method, endpoint, requestPayload });

  if (!WRITE_METHODS.has(method)) {
    return {
      enforced: true,
      mutation_class: mutationClass,
      preflight_status: "read_only_fetch"
    };
  }

  const details = {
    brand: normalize(brand?.brand_name || brand?.normalized_brand_name || requestPayload.brand || requestPayload.target_key),
    target_key: normalize(requestPayload.target_key || brand?.target_key),
    endpoint_key: normalize(endpoint.endpoint_key),
    method,
    mutation_class: mutationClass
  };

  if (!hasOperatorApproval(requestPayload)) {
    throwGate(
      "brand_mutation_operator_approval_required",
      "WordPress brand mutation requires explicit operator approval in mutation_approval/operator_approval.",
      details
    );
  }

  if (
    (mutationClass === "brand_live_publish_status_change" || lower(getBodyObject(requestPayload).status) === "publish") &&
    !bool(requestPayload.publish_status_gate_validated) &&
    !bool(requestPayload.mutation_approval?.publish_status_gate_validated)
  ) {
    throwGate(
      "brand_publish_status_gate_required",
      "WordPress live publish/status mutation requires publish_status_gate_validated=true.",
      details
    );
  }

  if (
    isTaxonomyMutationEndpoint(endpoint, requestPayload) &&
    !bool(requestPayload.taxonomy_mapping_validated) &&
    !bool(requestPayload.mutation_approval?.taxonomy_mapping_validated)
  ) {
    throwGate(
      "taxonomy_mapping_validation_required",
      "WordPress taxonomy-related mutation requires taxonomy_mapping_validated=true.",
      details
    );
  }

  if (
    isWpmlMutationEndpoint(endpoint, requestPayload) &&
    (
      !bool(requestPayload.wpml_import_validated) ||
      !bool(requestPayload.post_import_language_link_validation)
    )
  ) {
    throwGate(
      "wpml_import_link_validation_required",
      "WordPress/WPML multilingual mutation requires wpml_import_validated=true and post_import_language_link_validation=true.",
      details
    );
  }

  if (
    mutationClass === "brand_live_delete_or_destructive" &&
    !bool(requestPayload.high_risk_approval_granted) &&
    !bool(requestPayload.mutation_approval?.high_risk_approval_granted)
  ) {
    throwGate(
      "high_risk_mutation_approval_required",
      "Destructive WordPress mutation requires high_risk_approval_granted=true.",
      details
    );
  }

  if (isExplicitDryRunPreflight(requestPayload)) {
    return {
      enforced: true,
      mutation_class: mutationClass,
      preflight_status: "dry_run_preflight_only",
      dry_run: true,
      preflight_only: true,
      execution_blocked: true,
      no_outbound_request: true,
      details
    };
  }

  if (!hasCompletedDryRunPreflight(requestPayload) || !hasLiveExecutionApproval(requestPayload)) {
    throwGate(
      "approved_post_without_dry_run_blocked",
      "Approved WordPress mutation requires a completed dry-run/preflight and explicit live_execution_approved=true before outbound execution.",
      {
        ...details,
        dry_run_preflight_completed: hasCompletedDryRunPreflight(requestPayload),
        live_execution_approved: hasLiveExecutionApproval(requestPayload)
      }
    );
  }

  return {
    enforced: true,
    mutation_class: mutationClass,
    preflight_status: "passed"
  };
}
