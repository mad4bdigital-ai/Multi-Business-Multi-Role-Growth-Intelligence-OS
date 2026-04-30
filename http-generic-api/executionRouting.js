import {
  describeAllowedDelegatedTransportKeys,
  isSupportedDelegatedTransportActionKey
} from "./transportKeys.js";
import { buildGovernedExecutionContext } from "./governedContextResolution.js";
import {
  isGoogleSheetsRegistryRequest,
  resolveRegistrySurfaceTarget,
  assertRegistrySurfaceTargetAllowed
} from "./registrySurfaceResolution.js";

function requireDep(name, value) {
  if (typeof value !== "function") {
    throw new Error(`resolveHttpExecutionContext requires deps.${name}`);
  }
  return value;
}

export function resolveHttpExecutionContext(input = {}, deps = {}) {
  const {
    requestPayload = {},
    parent_action_key = "",
    endpoint_key = "",
    actionRows = [],
    endpointRows = [],
    brandRows = [],
    policies = [],
    allowedTransport = ""
  } = input;

  const debugLog = deps.debugLog || (() => {});
  const boolFromSheet = requireDep("boolFromSheet", deps.boolFromSheet);
  const policyValue = requireDep("policyValue", deps.policyValue);
  const resolveAction = requireDep("resolveAction", deps.resolveAction);
  const resolveEndpoint = requireDep("resolveEndpoint", deps.resolveEndpoint);
  const getEndpointExecutionSnapshot = requireDep("getEndpointExecutionSnapshot", deps.getEndpointExecutionSnapshot);
  const resolveBrand = requireDep("resolveBrand", deps.resolveBrand);
  const requireRuntimeCallableAction = requireDep("requireRuntimeCallableAction", deps.requireRuntimeCallableAction);
  const requireEndpointExecutionEligibility = requireDep("requireEndpointExecutionEligibility", deps.requireEndpointExecutionEligibility);
  const requireExecutionModeCompatibility = requireDep("requireExecutionModeCompatibility", deps.requireExecutionModeCompatibility);
  const requireNativeFamilyBoundary = requireDep("requireNativeFamilyBoundary", deps.requireNativeFamilyBoundary);
  const requireTransportIfDelegated = requireDep("requireTransportIfDelegated", deps.requireTransportIfDelegated);
  const requireNoFallbackDirectExecution = requireDep("requireNoFallbackDirectExecution", deps.requireNoFallbackDirectExecution);
  const isDelegatedTransportTarget = requireDep("isDelegatedTransportTarget", deps.isDelegatedTransportTarget);
  const ensureMethodAndPathMatchEndpoint = requireDep("ensureMethodAndPathMatchEndpoint", deps.ensureMethodAndPathMatchEndpoint);

  debugLog("FINAL_EXECUTION_PARENT_ACTION_KEY:", parent_action_key);
  debugLog("FINAL_EXECUTION_ENDPOINT_KEY:", endpoint_key);

  const action = resolveAction(actionRows, parent_action_key);
  debugLog("RESOLVED_ACTION_OBJECT:", JSON.stringify(action));

  const endpoint = resolveEndpoint(endpointRows, parent_action_key, endpoint_key);
  debugLog(
    "PRE_GUARD_ENDPOINT_OBJECT:",
    JSON.stringify(getEndpointExecutionSnapshot(endpoint))
  );

  const resolvedAllowedTransport = String(
    allowedTransport ||
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allowed Transport",
        "http_generic_api"
      )
  ).trim();

  let brand;
  let registrySurface = null;
  if (isGoogleSheetsRegistryRequest({
    parentActionKey: parent_action_key,
    endpointKey: endpoint_key,
    requestPayload
  })) {
    brand = resolveRegistrySurfaceTarget({
      targetKey: requestPayload.target_key,
      endpointKey: endpoint_key
    });
    assertRegistrySurfaceTargetAllowed(brand);
    registrySurface = brand;
  } else {
    brand = resolveBrand(brandRows, requestPayload, {
      allowedTransportKey: resolvedAllowedTransport
    });
  }

  debugLog(
    "PRE_GUARD_ACTION_RUNTIME:",
    JSON.stringify({
      action_key: action.action_key,
      runtime_capability_class: action.runtime_capability_class,
      runtime_callable: action.runtime_callable,
      primary_executor: action.primary_executor,
      oauth_config_file_id: action.oauth_config_file_id || ""
    })
  );

  requireRuntimeCallableAction(policies, action, endpoint);
  const endpointEligibility = requireEndpointExecutionEligibility(policies, endpoint);
  requireExecutionModeCompatibility(action, endpoint);
  requireNativeFamilyBoundary(policies, action, endpoint);
  requireTransportIfDelegated(policies, action, endpoint);
  requireNoFallbackDirectExecution(policies, endpoint);

  debugLog(
    "POST_GUARD_ENDPOINT_ELIGIBILITY:",
    JSON.stringify(endpointEligibility)
  );
  const governedContext = buildGovernedExecutionContext({
    requestPayload,
    brand,
    action,
    endpoint,
    policies
  });

  debugLog("GOVERNED_CONTEXT_RESOLUTION:", JSON.stringify(governedContext));

  const endpointExecutionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const endpointTransportActionKey = String(endpoint.transport_action_key || "").trim();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
  const sameServiceNativeTarget =
    endpointExecutionMode === "native_controller" ||
    String(endpoint.provider_domain || "").trim() === "same_service_native";

  debugLog(
    "TRANSPORT_COMPATIBILITY_INPUT:",
    JSON.stringify({
      endpoint_key: endpoint.endpoint_key,
      endpoint_transport_action_key: endpointTransportActionKey,
      endpoint_execution_mode: String(endpoint.execution_mode || "").trim(),
      endpoint_transport_required_raw: endpoint.transport_required ?? "",
      endpoint_transport_required: boolFromSheet(endpoint.transport_required),
      delegated_transport_target: delegatedTransportTarget,
      same_service_native_target: sameServiceNativeTarget
    })
  );

  if (
    !sameServiceNativeTarget &&
    endpointTransportActionKey &&
    !isSupportedDelegatedTransportActionKey(endpointTransportActionKey, {
      allowedTransport: resolvedAllowedTransport
    })
  ) {
    const err = new Error(
      `Endpoint transport_action_key is not supported: ${endpointTransportActionKey}; expected one of ${describeAllowedDelegatedTransportKeys(resolvedAllowedTransport)}`
    );
    err.code = "unsupported_transport";
    err.status = 403;
    throw err;
  }

  if (
    !sameServiceNativeTarget &&
    boolFromSheet(endpoint.transport_required) &&
    endpointExecutionMode === "http_delegated" &&
    !isSupportedDelegatedTransportActionKey(endpointTransportActionKey, {
      allowedTransport: resolvedAllowedTransport
    })
  ) {
    const err = new Error(
      `Delegated transport endpoint is missing required allowed transport: ${endpoint.endpoint_key}; expected one of ${describeAllowedDelegatedTransportKeys(resolvedAllowedTransport)}`
    );
    err.code = "missing_required_transport";
    err.status = 403;
    throw err;
  }

  const resolvedMethodPath = ensureMethodAndPathMatchEndpoint(
    endpoint,
    requestPayload.method,
    requestPayload.path,
    requestPayload.path_params || {}
  );

  return {
    action,
    endpoint,
    brand,
    registrySurface,
    governedContext,
    endpointEligibility,
    resolvedAllowedTransport,
    endpointExecutionMode,
    endpointTransportActionKey,
    delegatedTransportTarget,
    sameServiceNativeTarget,
    resolvedMethodPath
  };
}
