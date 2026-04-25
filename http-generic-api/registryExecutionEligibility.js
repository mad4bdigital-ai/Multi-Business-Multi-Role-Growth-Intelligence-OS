import { policyValue } from "./registryPolicyAccess.js";

function defaultBoolFromSheet(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function getBoolFromSheet(deps = {}) {
  return deps.boolFromSheet || defaultBoolFromSheet;
}

function getDebugLog(deps = {}) {
  return deps.debugLog || (() => {});
}

function isDelegatedTransportTarget(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

function getEndpointExecutionSnapshot(endpoint = {}, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_role: String(endpoint.endpoint_role || "").trim(),
    inventory_role: String(endpoint.inventory_role || "").trim(),
    inventory_source: String(endpoint.inventory_source || "").trim(),
    execution_mode: String(endpoint.execution_mode || "").trim(),
    transport_required_raw: endpoint.transport_required ?? "",
    transport_required: boolFromSheet(endpoint.transport_required),
    transport_action_key: String(endpoint.transport_action_key || "").trim(),
    delegated_transport_target: isDelegatedTransportTarget(endpoint, deps),
    status: String(endpoint.status || "").trim(),
    execution_readiness: String(endpoint.execution_readiness || "").trim(),
    provider_domain: String(endpoint.provider_domain || "").trim(),
    endpoint_path_or_function: String(endpoint.endpoint_path_or_function || "").trim(),
    notes: String(endpoint.notes || "").trim()
  };
}

export function requireRuntimeCallableAction(policies, action, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const requireCallable =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Require Runtime Callable For Direct Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const disallowPending =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Disallow Pending Binding Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const allowRegistryOnlyDirect =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Allow Registry Only Actions Direct Execution",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const capabilityClass = String(action.runtime_capability_class || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint, deps);

  if (disallowPending && capabilityClass === "pending_binding") {
    const err = new Error(`Action is pending binding and cannot execute: ${action.action_key}`);
    err.code = "action_pending_binding";
    err.status = 403;
    throw err;
  }

  if (
    requireCallable &&
    !delegatedTransportTarget &&
    primaryExecutor !== "http_client_backend" &&
    !runtimeCallable
  ) {
    const err = new Error(`Action is not runtime callable: ${action.action_key}`);
    err.code = "action_not_runtime_callable";
    err.status = 403;
    throw err;
  }

  if (
    !allowRegistryOnlyDirect &&
    !delegatedTransportTarget &&
    capabilityClass === "external_action_only" &&
    primaryExecutor !== "http_client_backend"
  ) {
    const err = new Error(
      `Registry-only external action cannot execute directly: ${action.action_key}`
    );
    err.code = "external_action_direct_execution_blocked";
    err.status = 403;
    throw err;
  }
}

export function requireEndpointExecutionEligibility(policies, endpoint, deps = {}) {
  const boolFromSheet = getBoolFromSheet(deps);
  const debugLog = getDebugLog(deps);
  const blockInventoryOnly =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Block Inventory Only Endpoints",
        "FALSE",
        deps
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const inventoryRole = String(endpoint.inventory_role || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint, deps);

  const snapshot = {
    ...getEndpointExecutionSnapshot(endpoint, deps),
    block_inventory_only: blockInventoryOnly
  };

  debugLog("ENDPOINT_EXECUTION_ELIGIBILITY_INPUT:", JSON.stringify(snapshot));

  if (blockInventoryOnly && !delegatedTransportTarget && endpointRole && endpointRole !== "primary") {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "endpoint_role_blocked" })
    );

    const err = new Error(
      `Endpoint is not a primary executable endpoint: ${endpoint.endpoint_key}`
    );
    err.code = "endpoint_role_blocked";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    inventoryRole &&
    inventoryRole !== "endpoint_inventory"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "inventory_only_endpoint" })
    );

    const err = new Error(
      `Non-executable inventory role cannot execute directly: ${endpoint.endpoint_key}`
    );
    err.code = "inventory_only_endpoint";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  debugLog("ENDPOINT_EXECUTION_ELIGIBILITY_PASS:", JSON.stringify(snapshot));

  return {
    endpointRole,
    executionMode,
    transportRequired,
    delegatedTransportTarget
  };
}

export function requireExecutionModeCompatibility(action, endpoint) {
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();

  if (executionMode === "native_direct") {
    const err = new Error(
      `Native-direct endpoint must use native GPT execution path, not http-execute: ${endpoint.endpoint_key}`
    );
    err.code = "native_direct_requires_native_path";
    err.status = 403;
    throw err;
  }

  if (executionMode === "http_delegated" && primaryExecutor !== "http_client_backend") {
    const err = new Error(
      `Execution mode mismatch: endpoint ${endpoint.endpoint_key} is http_delegated but parent executor is ${primaryExecutor || "unset"}.`
    );
    err.code = "execution_mode_mismatch";
    err.status = 403;
    throw err;
  }
}
