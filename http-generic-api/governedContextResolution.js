function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function bool(value) {
  if (value === true || value === false) return value;
  const normalized = lower(value);
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return "";
}

function jsonObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function throwContextGate(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = 403;
  err.details = details;
  throw err;
}

export function extractBusinessActivityContext(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const nestedActivity = jsonObject(context.business_activity);

  const businessActivityTypeKey = firstNonEmpty(
    requestPayload.business_activity_type_key,
    requestPayload.business_activity_key,
    requestPayload.activity_type_key,
    nestedActivity.business_activity_type_key,
    nestedActivity.business_activity_key,
    body.business_activity_type_key
  );

  const businessActivityType = firstNonEmpty(
    requestPayload.business_activity_type,
    requestPayload.activity_type,
    nestedActivity.business_activity_type,
    body.business_activity_type
  );

  return {
    requested: !!(businessActivityTypeKey || businessActivityType),
    business_activity_type_key: businessActivityTypeKey,
    business_activity_type: businessActivityType,
    surface: "surface.business_activity_type_registry",
    resolution_status: businessActivityTypeKey || businessActivityType ? "declared" : "not_declared",
    authority_rule: "business_activity_type_registry_first"
  };
}

export function extractLogicContext(requestPayload = {}) {
  const body = jsonObject(requestPayload.body);
  const context = jsonObject(requestPayload.context);
  const nestedLogic = jsonObject(context.logic);

  const logicId = firstNonEmpty(
    requestPayload.logic_id,
    requestPayload.logic_key,
    requestPayload.logic_profile_key,
    nestedLogic.logic_id,
    nestedLogic.logic_key,
    body.logic_id
  );

  const functionalRole = firstNonEmpty(
    requestPayload.logic_functional_role,
    requestPayload.functional_logic_role,
    nestedLogic.functional_role,
    body.logic_functional_role
  );

  const legacyExternalId = firstNonEmpty(
    requestPayload.legacy_logic_external_id,
    requestPayload.legacy_external_id,
    nestedLogic.legacy_external_id,
    body.legacy_logic_external_id
  );

  return {
    requested: !!(logicId || functionalRole || legacyExternalId),
    logic_id: logicId,
    functional_role: functionalRole,
    legacy_external_id: legacyExternalId,
    surface: "surface.logic_canonical_pointer_registry",
    knowledge_surface: "surface.logic_knowledge_profiles",
    resolution_status: logicId || functionalRole ? "declared" : legacyExternalId ? "legacy_lineage_only" : "not_declared",
    authority_rule: "logic_pointer_first"
  };
}

export function detectLegacyLogicExecutionRequest(logicContext = {}, requestPayload = {}) {
  const candidates = [
    logicContext.logic_id,
    logicContext.legacy_external_id,
    requestPayload.logic_id,
    requestPayload.logic_key,
    requestPayload.legacy_logic_external_id
  ].map(lower);

  return candidates.some(value =>
    value.includes("gpt-logic") ||
    value.includes("gpt_logic") ||
    value.startsWith("legacy.gpt") ||
    value.startsWith("legacy_logic") ||
    value.startsWith("legacy.logic")
  );
}

export function classifyBrandRequirement({ requestPayload = {}, endpoint = {} } = {}) {
  const providerDomain = lower(endpoint.provider_domain || requestPayload.provider_domain);
  const brandResolutionSource = lower(endpoint.brand_resolution_source);
  const path = lower(endpoint.endpoint_path_or_function || requestPayload.path);
  const parentActionKey = lower(endpoint.parent_action_key || requestPayload.parent_action_key);
  const hasBrandSelector =
    !!normalize(requestPayload.target_key) ||
    !!normalize(requestPayload.brand) ||
    !!normalize(requestPayload.brand_domain);

  const brandResolvedEndpoint =
    providerDomain === "target_resolved" ||
    !!brandResolutionSource ||
    parentActionKey === "wordpress_api" ||
    path.startsWith("/wp/v2/") ||
    path.startsWith("/jet-engine/v2/");

  return {
    required: brandResolvedEndpoint || hasBrandSelector,
    reason: brandResolvedEndpoint ? "brand_resolved_endpoint" : hasBrandSelector ? "brand_selector_present" : "not_required"
  };
}

export function buildBrandContext({ requestPayload = {}, brand = null, endpoint = {} } = {}) {
  const requirement = classifyBrandRequirement({ requestPayload, endpoint });
  const requestedTargetKey = normalize(requestPayload.target_key);
  const requestedBrand = normalize(requestPayload.brand);
  const requestedBrandDomain = normalize(requestPayload.brand_domain);

  return {
    required: requirement.required,
    reason: requirement.reason,
    requested_target_key: requestedTargetKey,
    requested_brand: requestedBrand,
    requested_brand_domain: requestedBrandDomain,
    resolved: !!brand,
    target_key: normalize(brand?.target_key),
    brand_name: normalize(brand?.brand_name || brand?.normalized_brand_name),
    brand_domain: normalize(brand?.brand_domain),
    surface: "surface.brand_registry_sheet",
    brand_core_surface: "surface.brand_core_registry",
    authority_rule: "brand_registry_then_brand_core"
  };
}

export function validateBrandContext(brandContext = {}) {
  if (brandContext.required && !brandContext.resolved) {
    throwContextGate(
      "brand_target_resolution_required",
      "Brand-targeted execution requires Brand Registry target resolution before runtime execution.",
      {
        requested_target_key: brandContext.requested_target_key,
        requested_brand: brandContext.requested_brand,
        requested_brand_domain: brandContext.requested_brand_domain,
        reason: brandContext.reason
      }
    );
  }

  if (
    brandContext.resolved &&
    brandContext.requested_target_key &&
    brandContext.target_key &&
    brandContext.requested_target_key !== brandContext.target_key
  ) {
    throwContextGate(
      "brand_target_key_mismatch",
      "Requested target_key does not match the resolved Brand Registry target_key.",
      {
        requested_target_key: brandContext.requested_target_key,
        resolved_target_key: brandContext.target_key,
        brand_name: brandContext.brand_name
      }
    );
  }
}

export function validateLogicContext(logicContext = {}, requestPayload = {}) {
  if (detectLegacyLogicExecutionRequest(logicContext, requestPayload)) {
    const lineageOnly =
      bool(requestPayload.legacy_logic_lineage_lookup) ||
      bool(requestPayload.lineage_lookup_only);

    if (!lineageOnly) {
      throwContextGate(
        "legacy_logic_direct_execution_blocked",
        "Legacy Logic identifiers may be used only as lineage evidence, not as direct execution authority.",
        {
          logic_id: logicContext.logic_id,
          legacy_external_id: logicContext.legacy_external_id,
          repair_action: "resolve_current_logic_via_logic_canonical_pointer_registry"
        }
      );
    }
  }
}

export function buildGovernedExecutionContext(input = {}) {
  const {
    requestPayload = {},
    brand = null,
    endpoint = {},
    action = {}
  } = input;

  const businessActivity = extractBusinessActivityContext(requestPayload);
  const logic = extractLogicContext(requestPayload);
  const brandContext = buildBrandContext({ requestPayload, brand, endpoint });

  validateBrandContext(brandContext);
  validateLogicContext(logic, requestPayload);

  const needsBusinessActivityBeforeKnowledge =
    businessActivity.requested ||
    logic.requested ||
    brandContext.required ||
    lower(endpoint.category_group).includes("cms") ||
    lower(endpoint.category_group).includes("content");

  return {
    ok: true,
    resolution_order: [
      "business_activity_type_registry",
      "brand_registry_and_brand_core",
      "logic_canonical_pointer_registry",
      "logic_knowledge_profiles",
      "task_routes",
      "workflow_registry",
      "actions_and_endpoint_registry"
    ],
    business_activity: {
      ...businessActivity,
      required_before_business_type_knowledge: needsBusinessActivityBeforeKnowledge
    },
    brand: brandContext,
    logic,
    action: {
      parent_action_key: normalize(action.action_key || endpoint.parent_action_key),
      endpoint_key: normalize(endpoint.endpoint_key),
      endpoint_role: normalize(endpoint.endpoint_role),
      execution_mode: normalize(endpoint.execution_mode)
    },
    gates: {
      legacy_logic_direct_execution_blocked: true,
      brand_core_required_for_brand_outputs: brandContext.required,
      business_activity_type_first: true,
      current_execution_authority_only: true
    }
  };
}
